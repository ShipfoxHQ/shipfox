import type {
  AgentToolCatalogEntry,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {ClickUpAgentToolResponse, ClickUpAgentToolsClient} from '#api/client.js';
import type {ClickUpTokenStore} from '#core/tokens.js';
import {
  CLICKUP_TOOL_OPERATIONS,
  clickupAgentToolCatalog,
  clickupAgentToolSelectionCatalog,
} from './agent-tools.js';
import {ClickUpIntegrationProviderError} from './errors.js';

type ClickUpIntegrationConnection = IntegrationConnection<'clickup'>;
type ClickUpToolCall = Parameters<AgentToolSession<ClickUpToolCallResult>['call']>[0];

export type ClickUpToolCallResult = {
  isError?: boolean | undefined;
  content: readonly {type: 'text'; text: string}[];
  structuredContent?: Record<string, unknown> | undefined;
};

export interface ClickUpAgentToolsProviderOptions {
  clickup: Pick<ClickUpAgentToolsClient, 'request'>;
  tokenStore: Pick<ClickUpTokenStore, 'getAccessToken'>;
}

export class ClickUpAgentToolsProvider
  implements
    AgentToolsProvider<
      ClickUpIntegrationConnection,
      'read' | 'write',
      unknown,
      ClickUpToolCallResult
    >
{
  constructor(private readonly options: ClickUpAgentToolsProviderOptions) {}

  catalog() {
    return clickupAgentToolCatalog;
  }

  selectionCatalog() {
    return clickupAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<ClickUpIntegrationConnection, 'read' | 'write', unknown>,
  ): Promise<AgentToolSession<ClickUpToolCallResult>> {
    const accessToken = await this.options.tokenStore.getAccessToken({
      connectionId: input.connection.id,
    });
    const teamId = input.connection.externalAccountId;

    return {
      call: (call) =>
        executeClickUpToolCall({
          call,
          tools: input.tools,
          accessToken,
          teamId,
          clickup: this.options.clickup,
        }),
      close: () => Promise.resolve(),
    };
  }
}

async function executeClickUpToolCall(params: {
  call: ClickUpToolCall;
  tools: readonly AgentToolCatalogEntry<'read' | 'write'>[];
  accessToken: string;
  teamId: string;
  clickup: Pick<ClickUpAgentToolsClient, 'request'>;
}): Promise<ClickUpToolCallResult> {
  const tool = params.tools.find((candidate) => candidate.id === params.call.toolId);
  if (!tool)
    return clickupToolError(`Unknown ClickUp tool: ${params.call.toolId}`, {
      code: 'invalid-request',
    });
  const operation =
    CLICKUP_TOOL_OPERATIONS[params.call.toolId as keyof typeof CLICKUP_TOOL_OPERATIONS];
  if (!operation)
    return clickupToolError(`Unknown ClickUp tool: ${params.call.toolId}`, {
      code: 'invalid-request',
    });
  const validationError = validateClickUpToolArguments(tool, params.call.arguments);
  if (validationError)
    return clickupToolError(validationError, {
      code: 'invalid-request',
    });

  const response = await requestClickUpTool({...params, operation});
  if (response instanceof ClickUpIntegrationProviderError) {
    return clickupToolError(response.message, {
      code: response.reason,
      retryAfterSeconds: response.retryAfterSeconds,
      status: response.status,
    });
  }
  return mapClickUpToolResponse(response);
}

async function requestClickUpTool(params: {
  call: ClickUpToolCall;
  accessToken: string;
  teamId: string;
  clickup: Pick<ClickUpAgentToolsClient, 'request'>;
  operation: (typeof CLICKUP_TOOL_OPERATIONS)[keyof typeof CLICKUP_TOOL_OPERATIONS];
}): Promise<ClickUpAgentToolResponse | ClickUpIntegrationProviderError> {
  try {
    return await params.clickup.request({
      accessToken: params.accessToken,
      teamId: params.teamId,
      method: params.operation.method,
      path: params.operation.path(params.call.arguments, params.teamId),
      ...(params.operation.query === undefined
        ? {}
        : {query: params.operation.query(params.call.arguments, params.teamId)}),
      ...(params.operation.body === undefined
        ? {}
        : {body: params.operation.body(params.call.arguments)}),
      operation: params.call.toolId,
    });
  } catch (error) {
    if (error instanceof ClickUpIntegrationProviderError) return error;
    throw error;
  }
}

function mapClickUpToolResponse(response: ClickUpAgentToolResponse): ClickUpToolCallResult {
  if (response.status === 400 || response.status === 404) {
    return clickupToolError(
      clickupErrorMessage(
        response.body,
        response.status === 404 ? 'ClickUp resource was not found' : 'ClickUp request was rejected',
      ),
      {code: 'provider-rejected', status: response.status},
    );
  }
  if (response.status < 200 || response.status >= 300) {
    return clickupToolError(`ClickUp request returned HTTP ${response.status}`, {
      code: 'provider-unavailable',
      status: response.status,
    });
  }
  return clickupToolResult(response.body, response.status);
}

function validateClickUpToolArguments(
  tool: AgentToolCatalogEntry<'read' | 'write'>,
  args: Record<string, unknown>,
): string | undefined {
  const required = tool.inputSchema.required;
  if (Array.isArray(required)) {
    const missingParameter = required.find(
      (parameter) => typeof parameter === 'string' && args[parameter] === undefined,
    );
    if (typeof missingParameter === 'string') {
      return `Missing required parameter: ${missingParameter}`;
    }
  }

  const properties = tool.inputSchema.properties;
  if (!isRecord(properties)) return undefined;
  for (const [name, value] of Object.entries(args)) {
    const schema = Object.hasOwn(properties, name) ? properties[name] : undefined;
    if (!isRecord(schema)) {
      if (tool.inputSchema.additionalProperties === false) return `Unknown parameter: ${name}`;
      continue;
    }
    const validationError = validateClickUpArgument(name, value, schema);
    if (validationError !== undefined) return validationError;
  }
  return undefined;
}

function validateClickUpArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  const typeError = clickUpArgumentTypeError(name, value, schema);
  if (typeError !== undefined) return typeError;
  if ('const' in schema && value !== schema.const) {
    return `Parameter ${name} must be ${JSON.stringify(schema.const)}`;
  }
  return undefined;
}

function clickUpArgumentTypeError(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (schema.type === 'string') {
    return typeof value === 'string' ? undefined : `Parameter ${name} must be a string`;
  }
  if (schema.type === 'boolean') {
    return typeof value === 'boolean' ? undefined : `Parameter ${name} must be a boolean`;
  }
  if (schema.type === 'integer') {
    return typeof value === 'number' && Number.isSafeInteger(value)
      ? undefined
      : `Parameter ${name} must be an integer`;
  }
  if (schema.type === 'object') {
    return isRecord(value) ? undefined : `Parameter ${name} must be an object`;
  }
  return schema.type === 'array' ? clickUpArrayArgumentError(name, value, schema.items) : undefined;
}

function clickUpArrayArgumentError(
  name: string,
  value: unknown,
  items: unknown,
): string | undefined {
  if (!Array.isArray(value)) return `Parameter ${name} must be an array`;
  if (!isRecord(items)) return undefined;
  for (const [index, item] of value.entries()) {
    const validationError = validateClickUpArgument(`${name}[${index}]`, item, items);
    if (validationError !== undefined) return validationError;
  }
  return undefined;
}

function clickupToolResult(body: unknown, status: number): ClickUpToolCallResult {
  let structuredContent: Record<string, unknown> = {status};
  if (isRecord(body)) structuredContent = body;
  else if (body !== undefined) structuredContent = {result: body};
  return {
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

function clickupToolError(
  message: string,
  options: {
    code?: string | undefined;
    retryAfterSeconds?: number | undefined;
    status?: number | undefined;
  } = {},
): ClickUpToolCallResult {
  const structuredContent = {
    ...(options.code === undefined ? {} : {code: options.code}),
    ...(options.retryAfterSeconds === undefined
      ? {}
      : {retryAfterSeconds: options.retryAfterSeconds}),
    ...(options.status === undefined ? {} : {status: options.status}),
  };
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    ...(Object.keys(structuredContent).length === 0 ? {} : {structuredContent}),
  };
}

function clickupErrorMessage(body: unknown, fallbackMessage: string): string {
  if (typeof body === 'string' && body.length > 0) return body;
  if (!isRecord(body)) return fallbackMessage;
  const error = typeof body.err === 'string' ? body.err : undefined;
  const code = typeof body.ECODE === 'string' ? body.ECODE : undefined;
  if (error !== undefined && code !== undefined) return `${error} (${code})`;
  return error ?? code ?? fallbackMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
