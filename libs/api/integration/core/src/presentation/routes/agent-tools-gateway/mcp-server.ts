import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {Ajv, type ValidateFunction} from 'ajv';
import {INVALID_METHOD_LABEL, type IntegrationToolCallRecorder, NO_METHOD_LABEL} from './audit.js';
import type {
  AuthorizedIntegrationTool,
  AuthorizedIntegrationToolMap,
} from './resolve-authorized-tools.js';

export interface IntegrationToolDispatchInput {
  authorizedTool: AuthorizedIntegrationTool;
  arguments: Record<string, unknown>;
  method?: string | undefined;
}

export type IntegrationToolDispatcher = (
  input: IntegrationToolDispatchInput,
) => Promise<CallToolResult>;

export interface BuildAgentToolsMcpServerParams {
  authorizedTools: AuthorizedIntegrationToolMap;
  dispatch: IntegrationToolDispatcher;
  recordCall?: IntegrationToolCallRecorder | undefined;
}

const ajv = new Ajv({strict: false, allErrors: true});

export function buildAgentToolsMcpServer(params: BuildAgentToolsMcpServerParams): Server {
  const server = new Server(
    {name: 'shipfox-integration-tools', version: '0.0.0'},
    {capabilities: {tools: {}}},
  );
  const validators = new Map<string, ValidateFunction>();

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...params.authorizedTools.values()].map((authorizedTool) => ({
      name: authorizedTool.mcpName,
      description: authorizedTool.description,
      inputSchema: authorizedTool.inputSchema as {
        type: 'object';
        properties?: Record<string, object> | undefined;
        required?: string[] | undefined;
      },
      ...(authorizedTool.outputSchema
        ? {
            outputSchema: authorizedTool.outputSchema as {
              type: 'object';
              properties?: Record<string, object> | undefined;
              required?: string[] | undefined;
            },
          }
        : {}),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const authorizedTool = params.authorizedTools.get(request.params.name);
    if (!authorizedTool) {
      recordToolCall(params.recordCall, {
        arguments: request.params.arguments ?? {},
        method: NO_METHOD_LABEL,
        outcome: 'invalid-request',
      });
      return toolError(`Unknown integration tool: ${request.params.name}`);
    }

    const args = request.params.arguments ?? {};
    if (!isRecord(args)) {
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method: NO_METHOD_LABEL,
        outcome: 'invalid-request',
      });
      return toolError('Tool arguments must be an object');
    }

    const methodValidation = validateMethod(authorizedTool, args);
    if (methodValidation.kind === 'error') {
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method: INVALID_METHOD_LABEL,
        outcome: 'invalid-request',
      });
      return toolError(methodValidation.message);
    }
    const method = methodValidation.method ?? NO_METHOD_LABEL;

    const schemaError = validateToolInput(authorizedTool, args, validators);
    if (schemaError) {
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method,
        outcome: 'invalid-request',
      });
      return toolError(schemaError);
    }

    try {
      const result = await params.dispatch({
        authorizedTool,
        arguments: args,
        method: methodValidation.method,
      });
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method,
        outcome: result.isError === true ? 'tool-error' : 'success',
      });
      return result;
    } catch (error) {
      recordToolCall(params.recordCall, {
        authorizedTool,
        arguments: args,
        method,
        outcome: 'exception',
      });
      throw error;
    }
  });

  return server;
}

function recordToolCall(
  recordCall: IntegrationToolCallRecorder | undefined,
  record: Parameters<IntegrationToolCallRecorder>[0],
): void {
  try {
    recordCall?.(record);
  } catch {
    // Audit and metrics must not affect MCP responses.
  }
}

function validateMethod(
  authorizedTool: AuthorizedIntegrationTool,
  args: Record<string, unknown>,
): {kind: 'ok'; method?: string | undefined} | {kind: 'error'; message: string} {
  if (!authorizedTool.tool.methods) return {kind: 'ok'};

  const method = args.method;
  if (typeof method !== 'string') {
    return {kind: 'error', message: 'Method-family tools require a string method argument'};
  }

  const allowedMethods = new Set(authorizedTool.tool.methods.map((candidate) => candidate.id));
  if (!allowedMethods.has(method)) {
    return {kind: 'error', message: `Unauthorized integration tool method: ${method}`};
  }

  return {kind: 'ok', method};
}

function validateToolInput(
  authorizedTool: AuthorizedIntegrationTool,
  args: Record<string, unknown>,
  validators: Map<string, ValidateFunction>,
): string | null {
  let validate = validators.get(authorizedTool.mcpName);
  if (!validate) {
    try {
      validate = ajv.compile(authorizedTool.inputSchema);
    } catch {
      return 'Tool input schema is invalid';
    }
    validators.set(authorizedTool.mcpName, validate);
  }

  if (validate(args)) return null;

  return `Tool arguments do not match input schema: ${ajv.errorsText(validate.errors, {
    separator: '; ',
  })}`;
}

function toolError(message: string): CallToolResult {
  return {
    isError: true,
    content: [{type: 'text', text: message}],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
