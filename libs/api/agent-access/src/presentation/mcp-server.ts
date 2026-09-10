import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {agentAccessEnvelopeSchema} from '@shipfox/api-agent-access-dto';
import type {AgentAccessContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {
  AGENT_ACCESS_ACTION_CALL_LIMIT,
  AGENT_ACCESS_MCP_INSTRUCTIONS,
  AGENT_ACCESS_MCP_SERVER_NAME,
} from '#constants.js';
import {agentAccessError, serializeAgentAccessEnvelope} from '#core/envelope.js';
import {type AgentAccessRateLimiter, createAgentAccessRateLimiter} from '#core/rate-limiter.js';
import {fitAgentAccessResponseToCeiling} from '#core/response.js';
import {
  type AgentAccessActionAudit,
  type AgentAccessAuthorityOutcome,
  type AgentAccessTool,
  type AgentAccessToolMap,
  createAgentAccessFixtureTool,
  createAgentAccessToolMap,
} from '#core/tools.js';
import {type AgentAccessToolCallOutcome, recordAgentAccessAuthorityCheck} from '#metrics/index.js';
import {AGENT_ACCESS_PACKAGE_VERSION} from '#version.js';
import {type AgentAccessToolCallRecorder, createAgentAccessToolCallRecorder} from './audit.js';

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
    createAgentAccessRateLimiter({limit: AGENT_ACCESS_ACTION_CALL_LIMIT});
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
      annotations: tool.annotations,
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
    recordToolCall(params.recordCall, {
      tool: tool?.name ?? 'unknown',
      outcome: 'rate-limited',
      errorCode: 'rate-limited',
      context: params.context,
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

async function executeAgentAccessTool(params: {
  tool: AgentAccessTool;
  input: Record<string, unknown>;
  context: AgentAccessContext;
  actionRateLimiter: AgentAccessRateLimiter;
  auth: AuthInterModuleClient | undefined;
  recordCall: AgentAccessToolCallRecorder;
}): Promise<CallToolResult> {
  const isAction = params.tool.annotations.readOnlyHint === false;
  let authorityOutcome: AgentAccessAuthorityOutcome = isAction ? 'not-checked' : 'ok';

  try {
    if (params.tool.validateInput?.(params.input) === false) {
      return invalidToolInputResult(params, authorityOutcome);
    }

    if (isAction) {
      const admission = await admitActionCall(params);
      if (admission.kind === 'rate-limited') {
        return actionRateLimitedResult(params, admission.retryAfterSeconds, authorityOutcome);
      }
      authorityOutcome = admission.authorityOutcome;
      if (authorityOutcome !== 'ok') {
        return recordEnvelopeResult(
          params,
          agentAccessError('authority-revoked', {
            message: `Agent grant authority was revoked: ${authorityOutcome}`,
          }),
          authorityOutcome,
        );
      }
    }

    const response = await params.tool.execute({context: params.context, arguments: params.input});
    const envelope = agentAccessEnvelopeSchema.safeParse(response);
    if (!envelope.success) {
      return recordEnvelopeResult(
        params,
        agentAccessError('invalid-tool-response'),
        authorityOutcome,
        'exception',
        'invalid-tool-response',
      );
    }

    if (envelope.data.ok && params.tool.validateResult?.(envelope.data.result) === false) {
      return recordEnvelopeResult(
        params,
        agentAccessError('invalid-tool-response'),
        authorityOutcome,
        'exception',
        'invalid-tool-response',
      );
    }

    return recordEnvelopeResult(
      params,
      fitAgentAccessResponseToCeiling(envelope.data),
      authorityOutcome,
    );
  } catch (error) {
    recordToolCall(params.recordCall, {
      tool: params.tool.name,
      outcome: 'exception',
      errorCode: 'unknown',
      context: params.context,
      action: actionAudit(params.tool, params.input, undefined, authorityOutcome),
    });
    logger().error({err: error, tool: params.tool.name}, 'Agent-access tool execution failed');
    reportError(error, {boundary: 'agent-access.mcp', operation: 'tool-call'});
    return toolResult(agentAccessError('tool-failed'), true);
  }
}

type ActionAdmission =
  | {kind: 'rate-limited'; retryAfterSeconds: number | undefined}
  | {kind: 'authority'; authorityOutcome: AgentAccessAuthorityOutcome};

async function admitActionCall(
  params: Parameters<typeof executeAgentAccessTool>[0],
): Promise<ActionAdmission> {
  const rateLimit = params.actionRateLimiter.consume(params.context.credential);
  if (!rateLimit.allowed) {
    return {kind: 'rate-limited', retryAfterSeconds: rateLimit.retry_after_seconds};
  }
  if (params.auth === undefined) throw new Error('Agent-access auth client is not configured');

  try {
    await params.auth.checkAgentGrantAuthority({
      grantId: params.context.credential.grantId,
      userId: params.context.userId,
      workspaceId: params.context.workspaceId,
    });
    recordAgentAccessAuthorityCheck('ok');
    return {kind: 'authority', authorityOutcome: 'ok'};
  } catch (error) {
    const reason = authorityRevocationReason(error);
    if (reason === undefined) throw error;
    recordAgentAccessAuthorityCheck(reason);
    return {kind: 'authority', authorityOutcome: reason};
  }
}

function invalidToolInputResult(
  params: Parameters<typeof executeAgentAccessTool>[0],
  authorityOutcome: AgentAccessAuthorityOutcome,
): CallToolResult {
  return recordEnvelopeResult(
    params,
    agentAccessError('invalid-request'),
    authorityOutcome,
    'invalid-request',
    'invalid-request',
  );
}

function actionRateLimitedResult(
  params: Parameters<typeof executeAgentAccessTool>[0],
  retryAfterSeconds: number | undefined,
  authorityOutcome: AgentAccessAuthorityOutcome,
): CallToolResult {
  return recordEnvelopeResult(
    params,
    agentAccessError('rate-limited', retryAfterSeconds === undefined ? {} : {retryAfterSeconds}),
    authorityOutcome,
    'rate-limited',
    'rate-limited',
  );
}

function recordEnvelopeResult(
  params: Parameters<typeof executeAgentAccessTool>[0],
  envelope: ReturnType<typeof agentAccessError>,
  authorityOutcome: AgentAccessAuthorityOutcome,
  outcome?: AgentAccessToolCallOutcome,
  errorCode?: string,
): CallToolResult {
  const boundedEnvelope = fitAgentAccessResponseToCeiling(envelope);
  recordToolCall(params.recordCall, {
    tool: params.tool.name,
    outcome: outcome ?? (boundedEnvelope.ok ? 'success' : 'tool-error'),
    errorCode:
      errorCode ?? (boundedEnvelope.ok ? 'none' : (boundedEnvelope.error?.code ?? 'unknown')),
    context: params.context,
    action: actionAudit(params.tool, params.input, boundedEnvelope, authorityOutcome),
  });
  return toolResult(boundedEnvelope, !boundedEnvelope.ok);
}

function actionAudit(
  tool: AgentAccessTool,
  input: Record<string, unknown>,
  result: ReturnType<typeof agentAccessError> | undefined,
  authorityOutcome: AgentAccessAuthorityOutcome,
): AgentAccessActionAudit | undefined {
  if (tool.annotations.readOnlyHint !== false) return undefined;
  try {
    return {
      ...(tool.actionAudit?.({input, result, authorityOutcome}) ?? {
        kind: tool.name,
        inputs_supplied: Object.keys(input).length > 0,
      }),
      authority_outcome: authorityOutcome,
    };
  } catch {
    return {
      kind: tool.name,
      inputs_supplied: Object.keys(input).length > 0,
      authority_outcome: authorityOutcome,
    };
  }
}

function authorityRevocationReason(
  error: unknown,
): Exclude<AgentAccessAuthorityOutcome, 'ok' | 'not-checked'> | undefined {
  if (!isInterModuleKnownError(authInterModuleContract.methods.checkAgentGrantAuthority, error)) {
    return undefined;
  }
  return error.code === 'authority-revoked' ? error.details.reason : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
