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
  if (!tool) return clickupToolError(`Unknown ClickUp tool: ${params.call.toolId}`);
  const operation =
    CLICKUP_TOOL_OPERATIONS[params.call.toolId as keyof typeof CLICKUP_TOOL_OPERATIONS];
  if (!operation) return clickupToolError(`Unknown ClickUp tool: ${params.call.toolId}`);
  const missingParameter = missingRequiredParameter(tool, params.call.arguments);
  if (missingParameter) return clickupToolError(`Missing required parameter: ${missingParameter}`);

  const response = await requestClickUpTool({...params, operation});
  if (response instanceof ClickUpIntegrationProviderError) {
    return clickupToolError(response.message, {
      code: response.reason,
      retryAfterSeconds: response.retryAfterSeconds,
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
    );
  }
  if (response.status < 200 || response.status >= 300) {
    return clickupToolError(`ClickUp request returned HTTP ${response.status}`);
  }
  return clickupToolResult(response.body, response.status);
}

function missingRequiredParameter(
  tool: AgentToolCatalogEntry<'read' | 'write'>,
  args: Record<string, unknown>,
): string | undefined {
  const required = tool.inputSchema.required;
  if (!Array.isArray(required)) return undefined;
  return required.find(
    (parameter) => typeof parameter === 'string' && args[parameter] === undefined,
  );
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
  options: {code?: string | undefined; retryAfterSeconds?: number | undefined} = {},
): ClickUpToolCallResult {
  const structuredContent = {
    ...(options.code === undefined ? {} : {code: options.code}),
    ...(options.retryAfterSeconds === undefined
      ? {}
      : {retryAfterSeconds: options.retryAfterSeconds}),
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
