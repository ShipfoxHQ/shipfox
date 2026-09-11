import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  type AgentAccessEnvelopeDto,
  agentAccessEnvelopeSchema,
} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {
  AGENT_ACCESS_ACTION_TOOL_CALL_LIMIT,
  AGENT_ACCESS_MCP_INSTRUCTIONS,
  AGENT_ACCESS_MCP_SERVER_NAME,
} from '#constants.js';
import {agentAccessError, serializeAgentAccessEnvelope} from '#core/envelope.js';
import {type AgentAccessRateLimiter, createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {fitAgentAccessResponseToCeiling} from '#core/response.js';
import {
  type AgentAccessTool,
  type AgentAccessToolMap,
  createAgentAccessFixtureTool,
  createAgentAccessToolMap,
} from '#core/tools.js';
import {type AgentAccessToolCallOutcome, recordAgentAccessAuthorityCheck} from '#metrics/index.js';
import {AGENT_ACCESS_PACKAGE_VERSION} from '#version.js';
import {
  type AgentAccessActionAudit,
  type AgentAccessToolCallRecorder,
  createAgentAccessToolCallRecorder,
} from './audit.js';

export interface BuildAgentAccessMcpServerParams {
  context: AgentAccessContext;
  tools?: readonly AgentAccessTool[] | undefined;
  rateLimiter?: AgentAccessRateLimiter | undefined;
  actionRateLimiter?: AgentAccessRateLimiter | undefined;
  auth?: AuthInterModuleClient | undefined;
  recordCall?: AgentAccessToolCallRecorder | undefined;
}

const defaultTools = (): readonly AgentAccessTool[] => [createAgentAccessFixtureTool()];

export function buildAgentAccessMcpServer(params: BuildAgentAccessMcpServerParams): Server {
  const tools = createAgentAccessToolMap(params.tools ?? defaultTools());
  const rateLimiter = params.rateLimiter ?? createAgentAccessRateLimiter();
  const actionRateLimiter =
    params.actionRateLimiter ??
    createAgentAccessRateLimiter({limit: AGENT_ACCESS_ACTION_TOOL_CALL_LIMIT});
  const recordCall = params.recordCall ?? createAgentAccessToolCallRecorder();
  const server = new Server(
    {name: AGENT_ACCESS_MCP_SERVER_NAME, version: AGENT_ACCESS_PACKAGE_VERSION},
    {
      capabilities: {tools: {}},
      instructions: AGENT_ACCESS_MCP_INSTRUCTIONS,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as {
        type: 'object';
        properties?: Record<string, object> | undefined;
        required?: string[] | undefined;
      },
      outputSchema: tool.outputSchema as {
        type: 'object';
        properties?: Record<string, object> | undefined;
        required?: string[] | undefined;
      },
      annotations: {...tool.annotations},
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) =>
    handleAgentAccessToolCall({
      name: request.params.name,
      arguments: request.params.arguments,
      context: params.context,
      tools,
      rateLimiter,
      actionRateLimiter,
      auth: params.auth,
      recordCall,
    }),
  );

  return server;
}

interface HandleAgentAccessToolCallParams {
  name: string;
  arguments?: Record<string, unknown> | undefined;
  context: AgentAccessContext;
  tools: AgentAccessToolMap;
  rateLimiter: AgentAccessRateLimiter;
  actionRateLimiter: AgentAccessRateLimiter;
  auth: AuthInterModuleClient | undefined;
  recordCall: AgentAccessToolCallRecorder;
}

async function handleAgentAccessToolCall(
  params: HandleAgentAccessToolCallParams,
): Promise<CallToolResult> {
  const tool = params.tools.get(params.name);
  const rateLimit = params.rateLimiter.consume(params.context.credential);
  if (!rateLimit.allowed) {
    const action =
      tool !== undefined && isActionTool(tool)
        ? createActionAudit(tool, isRecord(params.arguments) ? params.arguments : {})
        : undefined;
    recordToolCall(params.recordCall, {
      tool: tool?.name ?? 'unknown',
      outcome: 'rate-limited',
      errorCode: 'rate-limited',
      context: params.context,
      ...(action === undefined ? {} : {action}),
    });
    return toolResult(
      agentAccessError(
        'rate-limited',
        rateLimit.retry_after_seconds === undefined
          ? {}
          : {retryAfterSeconds: rateLimit.retry_after_seconds},
      ),
      true,
    );
  }
  if (tool === undefined) return unknownToolResult(params);

  const input = params.arguments ?? {};
  if (!isRecord(input)) return invalidArgumentsResult(params, tool.name);
  return await executeAgentAccessTool({
    tool,
    input,
    context: params.context,
    actionRateLimiter: params.actionRateLimiter,
    auth: params.auth,
    recordCall: params.recordCall,
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep the security-sensitive dispatch order together.
async function executeAgentAccessTool(params: {
  tool: AgentAccessTool;
  input: Record<string, unknown>;
  context: AgentAccessContext;
  actionRateLimiter: AgentAccessRateLimiter;
  auth: AuthInterModuleClient | undefined;
  recordCall: AgentAccessToolCallRecorder;
}): Promise<CallToolResult> {
  let action = isActionTool(params.tool) ? createActionAudit(params.tool, params.input) : undefined;
  try {
    if (params.tool.validateInput?.(params.input) === false) {
      recordToolCall(params.recordCall, {
        tool: params.tool.name,
        outcome: 'invalid-request',
        errorCode: 'invalid-request',
        context: params.context,
        ...(action === undefined ? {} : {action}),
      });
      return toolResult(agentAccessError('invalid-request'), true);
    }

    if (action !== undefined) {
      const authorization = await authorizeAction({
        action,
        actionRateLimiter: params.actionRateLimiter,
        auth: params.auth,
        context: params.context,
      });
      action = authorization.action;
      if (authorization.error !== undefined) throw authorization.error;
      if (authorization.response !== undefined) {
        recordToolCall(params.recordCall, {
          tool: params.tool.name,
          outcome: authorization.outcome ?? 'rate-limited',
          errorCode: authorization.errorCode ?? 'rate-limited',
          context: params.context,
          action,
        });
        return authorization.response;
      }
    }

    const response = await params.tool.execute({context: params.context, arguments: params.input});
    const envelope = validateAgentAccessToolResponse(params.tool, response);
    if (envelope === undefined) {
      recordToolCall(params.recordCall, {
        tool: params.tool.name,
        outcome: 'exception',
        errorCode: 'invalid-tool-response',
        context: params.context,
        ...(action === undefined ? {} : {action}),
      });
      return toolResult(agentAccessError('invalid-tool-response'), true);
    }

    const boundedEnvelope = fitAgentAccessResponseToCeiling(envelope);
    if (action !== undefined) action = completeActionAudit(action, boundedEnvelope);
    const outcome: AgentAccessToolCallOutcome = boundedEnvelope.ok ? 'success' : 'tool-error';
    const result = toolResult(boundedEnvelope, !boundedEnvelope.ok);
    recordToolCall(params.recordCall, {
      tool: params.tool.name,
      outcome,
      errorCode: boundedEnvelope.ok ? 'none' : (boundedEnvelope.error?.code ?? 'unknown'),
      context: params.context,
      ...(action === undefined ? {} : {action}),
    });
    return result;
  } catch (error) {
    recordToolCall(params.recordCall, {
      tool: params.tool.name,
      outcome: 'exception',
      errorCode: 'unknown',
      context: params.context,
      ...(action === undefined ? {} : {action}),
    });
    logger().error({err: error, tool: params.tool.name}, 'Agent-access tool execution failed');
    reportError(error, {boundary: 'agent-access.mcp', operation: 'tool-call'});
    return toolResult(agentAccessError('tool-failed'), true);
  }
}

function validateAgentAccessToolResponse(
  tool: AgentAccessTool,
  response: unknown,
): AgentAccessEnvelopeDto | undefined {
  const envelope = agentAccessEnvelopeSchema.safeParse(response);
  if (!envelope.success) return undefined;
  if (envelope.data.ok && tool.validateResult?.(envelope.data.result) === false) return undefined;
  return envelope.data;
}

interface AuthorizeActionResult {
  action: AgentAccessActionAudit;
  response?: CallToolResult;
  outcome?: AgentAccessToolCallOutcome;
  errorCode?: string;
  error?: unknown;
}

async function authorizeAction(params: {
  action: AgentAccessActionAudit;
  actionRateLimiter: AgentAccessRateLimiter;
  auth: AuthInterModuleClient | undefined;
  context: AgentAccessContext;
}): Promise<AuthorizeActionResult> {
  const rateLimit = params.actionRateLimiter.consume(params.context.credential);
  if (!rateLimit.allowed) {
    return {
      action: params.action,
      outcome: 'rate-limited',
      errorCode: 'rate-limited',
      response: toolResult(
        agentAccessError(
          'rate-limited',
          rateLimit.retry_after_seconds === undefined
            ? {}
            : {retryAfterSeconds: rateLimit.retry_after_seconds},
        ),
        true,
      ),
    };
  }
  if (params.auth === undefined) {
    return {
      action: {...params.action, authority_outcome: 'dependency-failed'},
      error: new Error('Agent-access auth client is not configured'),
    };
  }

  try {
    await params.auth.checkAgentGrantAuthority({
      grantId: params.context.credential.grantId,
      userId: params.context.userId,
      workspaceId: params.context.workspaceId,
    });
    recordAgentAccessAuthorityCheck('ok');
    return {action: {...params.action, authority_outcome: 'ok'}};
  } catch (error) {
    if (!isInterModuleKnownError(authInterModuleContract.methods.checkAgentGrantAuthority, error)) {
      return {
        action: {...params.action, authority_outcome: 'dependency-failed'},
        error,
      };
    }
    const reason = error.details.reason;
    recordAgentAccessAuthorityCheck(reason);
    return {
      action: {...params.action, authority_outcome: reason},
      outcome: 'tool-error',
      errorCode: 'authority-revoked',
      response: toolResult(
        agentAccessError('authority-revoked', {
          message: `Agent authority revoked: ${reason}`,
        }),
        true,
      ),
    };
  }
}

function unknownToolResult(params: HandleAgentAccessToolCallParams): CallToolResult {
  recordToolCall(params.recordCall, {
    tool: 'unknown',
    outcome: 'invalid-request',
    errorCode: 'unknown-tool',
    context: params.context,
  });
  return toolResult(agentAccessError('unknown-tool', {message: 'Tool is not available'}), true);
}

function invalidArgumentsResult(
  params: HandleAgentAccessToolCallParams,
  toolName: string,
): CallToolResult {
  recordToolCall(params.recordCall, {
    tool: toolName,
    outcome: 'invalid-request',
    errorCode: 'invalid-request',
    context: params.context,
  });
  return toolResult(
    agentAccessError('invalid-request', {message: 'Tool arguments must be an object'}),
    true,
  );
}

function toolResult(
  envelope: ReturnType<typeof agentAccessError>,
  isError: boolean,
): CallToolResult {
  return {
    ...(isError ? {isError: true} : {}),
    content: [{type: 'text', text: serializeAgentAccessEnvelope(envelope)}],
    structuredContent: envelope as Record<string, unknown>,
  };
}

function recordToolCall(
  recordCall: AgentAccessToolCallRecorder,
  record: Parameters<AgentAccessToolCallRecorder>[0],
): void {
  try {
    recordCall(record);
  } catch (error) {
    logger().error({err: error}, 'Failed to record agent-access tool audit event');
    reportError(error, {boundary: 'agent-access.mcp', operation: 'audit'});
  }
}

function isActionTool(tool: AgentAccessTool): boolean {
  return tool.annotations.readOnlyHint === false;
}

function createActionAudit(
  tool: AgentAccessTool,
  input: Record<string, unknown>,
): AgentAccessActionAudit {
  const target: Record<string, unknown> = {};
  const targetFields: Record<string, string> = {
    run_id: 'target_run_id',
    definition_id: 'target_definition_id',
    project_id: 'project_id',
    ref: 'ref',
    commit: 'commit',
    config_path: 'config_path',
    trigger: 'trigger',
    replay_event_id: 'replay_event_id',
  };
  for (const [inputKey, auditKey] of Object.entries(targetFields)) {
    const value = input[inputKey];
    if (typeof value === 'string') target[auditKey] = value;
  }

  return {
    kind: tool.name,
    target,
    ...(typeof input.mode === 'string' ? {mode: input.mode} : {}),
    ...(typeof input.expected_attempt === 'number'
      ? {expected_attempt: input.expected_attempt}
      : {}),
    inputs_supplied: input.inputs !== undefined,
    idempotency_key: typeof input.idempotency_key === 'string',
    authority_outcome: 'not-checked',
  };
}

function completeActionAudit(
  action: AgentAccessActionAudit,
  envelope: AgentAccessEnvelopeDto,
): AgentAccessActionAudit {
  if (!envelope.ok || !isRecord(envelope.result)) return action;
  const result = envelope.result;
  let resultAttempt: number | undefined;
  if (typeof result.workflow_run_attempt === 'number') {
    resultAttempt = result.workflow_run_attempt;
  } else if (typeof result.attempt === 'number') {
    resultAttempt = result.attempt;
  }
  return {
    ...action,
    ...(typeof result.deduplicated === 'boolean' ? {deduplicated: result.deduplicated} : {}),
    ...(typeof result.run_id === 'string' ? {result_run_id: result.run_id} : {}),
    ...(resultAttempt === undefined ? {} : {result_attempt: resultAttempt}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
