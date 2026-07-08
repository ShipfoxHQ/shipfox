import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {Ajv, type ValidateFunction} from 'ajv';
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
    if (!authorizedTool) return toolError(`Unknown integration tool: ${request.params.name}`);

    const args = request.params.arguments ?? {};
    if (!isRecord(args)) return toolError('Tool arguments must be an object');

    const methodValidation = validateMethod(authorizedTool, args);
    if (methodValidation.kind === 'error') return toolError(methodValidation.message);

    const schemaError = validateToolInput(authorizedTool, args, validators);
    if (schemaError) return toolError(schemaError);

    const result = await params.dispatch({
      authorizedTool,
      arguments: args,
      method: methodValidation.method,
    });
    return result;
  });

  return server;
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
