import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {NotionAgentToolId} from '@shipfox/api-integration-notion-dto';
import type {
  AgentToolCatalogEntry,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {NotionAgentToolResponse, NotionAgentToolsClient} from '#api/client.js';
import type {NotionTokenStore} from '#core/tokens.js';
import {
  NOTION_TOOL_OPERATIONS,
  type NotionToolOperation,
  notionAgentToolCatalog,
  notionAgentToolSelectionCatalog,
} from './agent-tools.js';
import {NotionIntegrationProviderError} from './errors.js';
import {normalizeNotionId} from './notion-id.js';

export type NotionIntegrationConnection = IntegrationConnection<'notion'>;
export type NotionToolCall = Parameters<AgentToolSession<CallToolResult>['call']>[0];

export interface NotionAgentToolsProviderOptions {
  notion: Pick<NotionAgentToolsClient, 'request'>;
  tokenStore: Pick<NotionTokenStore, 'getAccessToken'>;
}

export class NotionAgentToolsProvider
  implements
    AgentToolsProvider<NotionIntegrationConnection, 'read' | 'write', unknown, CallToolResult>
{
  constructor(private readonly options: NotionAgentToolsProviderOptions) {}

  catalog() {
    return notionAgentToolCatalog;
  }

  selectionCatalog() {
    return notionAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<NotionIntegrationConnection, 'read' | 'write', unknown>,
  ): Promise<AgentToolSession<CallToolResult>> {
    let accessToken = await this.options.tokenStore.getAccessToken({
      connectionId: input.connection.id,
    });

    return {
      call: async (call) => {
        const result = await executeNotionToolCall({
          call,
          tools: input.tools,
          accessToken,
          connectionId: input.connection.id,
          notion: this.options.notion,
          refreshAccessToken: async () => {
            accessToken = await this.options.tokenStore.getAccessToken({
              connectionId: input.connection.id,
              forceRefresh: true,
            });
            return accessToken;
          },
        });
        return result;
      },
      close: () => Promise.resolve(),
    };
  }
}

async function executeNotionToolCall(params: {
  call: NotionToolCall;
  tools: readonly AgentToolCatalogEntry<'read' | 'write'>[];
  accessToken: string;
  connectionId: string;
  notion: Pick<NotionAgentToolsClient, 'request'>;
  refreshAccessToken: () => Promise<string>;
}): Promise<CallToolResult> {
  const tool = params.tools.find((candidate) => candidate.id === params.call.toolId);
  if (!tool)
    return notionToolError(`Unknown Notion tool: ${params.call.toolId}`, 'invalid-request');

  const operation = NOTION_TOOL_OPERATIONS[params.call.toolId as NotionAgentToolId];
  if (!operation)
    return notionToolError(`Unknown Notion tool: ${params.call.toolId}`, 'invalid-request');

  const validationError = validateNotionToolArguments(tool, params.call.arguments);
  if (validationError) return notionToolError(validationError, 'invalid-request');

  try {
    let accessToken = params.accessToken;
    let refreshed = false;
    const requestWithRefresh = async (requestOperation: NotionToolOperation) => {
      let response = await requestNotionTool({...params, accessToken}, requestOperation);
      if (response.status !== 401 || refreshed) return response;
      refreshed = true;
      try {
        accessToken = await params.refreshAccessToken();
      } catch {
        throw new NotionIntegrationProviderError(
          'credentials-unavailable',
          'Notion credentials are unavailable. Reconnect Notion and try again.',
          undefined,
          401,
        );
      }
      response = await requestNotionTool({...params, accessToken}, requestOperation);
      return response;
    };

    if (params.call.toolId === 'update_page') {
      return await executeNotionPageUpdate(params, requestWithRefresh);
    }

    return mapNotionToolResponse(params.call.toolId, await requestWithRefresh(operation));
  } catch (error) {
    if (error instanceof NotionIntegrationProviderError) {
      return notionToolError(error.message, error.reason, error.status, error.retryAfterSeconds);
    }
    throw error;
  }
}

type RequestNotionToolWithRefresh = (
  operation: NotionToolOperation,
) => Promise<NotionAgentToolResponse>;

async function executeNotionPageUpdate(
  params: {
    call: NotionToolCall;
    accessToken: string;
    notion: Pick<NotionAgentToolsClient, 'request'>;
  },
  requestWithRefresh: RequestNotionToolWithRefresh,
): Promise<CallToolResult> {
  const args = params.call.arguments;
  const propertiesResponse = await requestPageProperties(args, requestWithRefresh);
  if (propertiesResponse !== undefined) {
    const propertiesResult = mapNotionToolResponse('update_page', propertiesResponse);
    if (propertiesResult.isError) return propertiesResult;
  }

  const contentStep = await requestPageContent(args, requestWithRefresh);
  if (contentStep === undefined) {
    return updateResult(propertiesResponse?.body, {
      propertiesUpdated: propertiesResponse !== undefined,
      contentUpdated: false,
    });
  }
  if ('error' in contentStep) {
    return withUpdateStatus(
      notionToolError(
        contentStep.error.message,
        contentStep.error.reason,
        contentStep.error.status,
        contentStep.error.retryAfterSeconds,
      ),
      {propertiesUpdated: propertiesResponse !== undefined, contentUpdated: false},
    );
  }

  const contentResult = mapNotionToolResponse('update_page', contentStep.response);
  if (contentResult.isError) {
    return propertiesResponse !== undefined
      ? withUpdateStatus(contentResult, {propertiesUpdated: true, contentUpdated: false})
      : contentResult;
  }
  return updateResult(contentStep.response.body, {
    propertiesUpdated: propertiesResponse !== undefined,
    contentUpdated: true,
  });
}

async function requestPageProperties(
  args: Record<string, unknown>,
  requestWithRefresh: RequestNotionToolWithRefresh,
): Promise<NotionAgentToolResponse | undefined> {
  if (args.properties === undefined) return undefined;
  const operation = NOTION_TOOL_OPERATIONS.update_page;
  if (operation === undefined) throw new Error('Missing update_page operation');
  return await requestWithRefresh(operation);
}

async function requestPageContent(
  args: Record<string, unknown>,
  requestWithRefresh: RequestNotionToolWithRefresh,
): Promise<
  {response: NotionAgentToolResponse} | {error: NotionIntegrationProviderError} | undefined
> {
  if (args.markdown === undefined) return undefined;
  try {
    return {
      response: await requestWithRefresh({
        method: 'PATCH',
        path: (contentArgs) =>
          `/v1/pages/${encodeURIComponent(normalizeNotionId(stringArgument(contentArgs, 'page_id')))}/markdown`,
        body: (contentArgs) => ({
          markdown: contentArgs.markdown,
          mode: contentArgs.mode,
        }),
      }),
    };
  } catch (error) {
    if (error instanceof NotionIntegrationProviderError) return {error};
    throw error;
  }
}

function updateResult(
  body: unknown,
  status: {propertiesUpdated: boolean; contentUpdated: boolean},
): CallToolResult {
  const structuredContent = {
    ...(isRecord(body) ? body : {result: body}),
    properties_updated: status.propertiesUpdated,
    content_updated: status.contentUpdated,
  };
  return {
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

function withUpdateStatus(
  result: CallToolResult,
  status: {propertiesUpdated: boolean; contentUpdated: boolean},
): CallToolResult {
  const structuredContent = {
    ...(isRecord(result.structuredContent) ? result.structuredContent : {}),
    properties_updated: status.propertiesUpdated,
    content_updated: status.contentUpdated,
  };
  return {
    ...result,
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

async function requestNotionTool(
  params: {
    call: NotionToolCall;
    accessToken: string;
    notion: Pick<NotionAgentToolsClient, 'request'>;
  },
  operation: NotionToolOperation,
): Promise<NotionAgentToolResponse> {
  return await params.notion.request({
    accessToken: params.accessToken,
    method: operation.method,
    path: operation.path(params.call.arguments),
    ...(operation.query === undefined ? {} : {query: operation.query(params.call.arguments)}),
    ...(operation.body === undefined ? {} : {body: operation.body(params.call.arguments)}),
    operation: params.call.toolId,
  });
}

function mapNotionToolResponse(toolId: string, response: NotionAgentToolResponse): CallToolResult {
  if (response.status === 401) {
    return notionToolError(
      'Notion credentials are unavailable. Reconnect Notion and try again.',
      'credentials-unavailable',
      response.status,
    );
  }
  if (response.status === 403 || isObjectNotFound(response.body)) {
    return notionToolError(
      'The Notion page is not shared with the Shipfox connection.',
      'access-denied',
      response.status,
    );
  }
  if (response.status < 200 || response.status >= 300) {
    return notionToolError(
      `Notion request returned HTTP ${response.status}`,
      'provider-rejected',
      response.status,
    );
  }

  const body = toolId === 'get_page' ? mapPageResponse(response.body) : response.body;
  const structuredContent = isRecord(body) ? body : {result: body};
  return {
    content: [{type: 'text', text: JSON.stringify(structuredContent)}],
    structuredContent,
  };
}

function mapPageResponse(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) return {result: body};
  return {
    ...body,
    title: notionPageTitle(body),
  };
}

function notionPageTitle(page: Record<string, unknown>): string {
  const properties = page.properties;
  if (!isRecord(properties)) return '';
  for (const property of Object.values(properties)) {
    if (!isRecord(property) || property.type !== 'title' || !Array.isArray(property.title))
      continue;
    return property.title
      .filter(isRecord)
      .map((item) => (typeof item.plain_text === 'string' ? item.plain_text : ''))
      .join('');
  }
  return '';
}

function validateNotionToolArguments(
  tool: AgentToolCatalogEntry<'read' | 'write'>,
  args: Record<string, unknown>,
): string | undefined {
  const schema = tool.inputSchema;
  const required = schema.required;
  if (Array.isArray(required)) {
    const missing = required.find((name) => typeof name === 'string' && args[name] === undefined);
    if (typeof missing === 'string') return `Missing required parameter: ${missing}`;
  }
  if (!isRecord(schema.properties)) return undefined;
  for (const [name, value] of Object.entries(args)) {
    const property = Object.hasOwn(schema.properties, name) ? schema.properties[name] : undefined;
    if (!isRecord(property)) {
      if (schema.additionalProperties === false) return `Unknown parameter: ${name}`;
      continue;
    }
    const error = validateNotionArgument(name, value, property);
    if (error !== undefined) return error;
  }
  return validateNotionToolSpecificArguments(tool.id, args);
}

function validateNotionToolSpecificArguments(
  toolId: string,
  args: Record<string, unknown>,
): string | undefined {
  switch (toolId) {
    case 'create_page':
      return validateCreatePageArguments(args);
    case 'update_page':
      return validateUpdatePageArguments(args);
    case 'add_comment':
      return validateAddCommentArguments(args);
    default:
      return undefined;
  }
}

function validateCreatePageArguments(args: Record<string, unknown>): string | undefined {
  const parent = args.parent;
  if (!isRecord(parent)) return 'Parameter parent must be an object';
  const parentKeys = ['page_id', 'data_source_id'].filter((key) => typeof parent[key] === 'string');
  return parentKeys.length === 1
    ? undefined
    : 'Parameter parent must contain exactly one of page_id or data_source_id';
}

function validateUpdatePageArguments(args: Record<string, unknown>): string | undefined {
  if (args.properties === undefined && args.markdown === undefined) {
    return 'At least one of properties or markdown is required';
  }
  if (args.markdown !== undefined && args.mode === undefined) {
    return 'Missing required parameter: mode';
  }
  return args.markdown === undefined && args.mode !== undefined
    ? 'Parameter mode requires markdown'
    : undefined;
}

function validateAddCommentArguments(args: Record<string, unknown>): string | undefined {
  const hasPage = typeof args.page_id === 'string';
  const hasDiscussion = typeof args.discussion_id === 'string';
  return hasPage !== hasDiscussion
    ? undefined
    : 'Exactly one of page_id or discussion_id is required';
}

function validateNotionArgument(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  return (
    validateNotionArgumentType(name, value, schema) ??
    validateNotionArgumentConstraints(name, value, schema)
  );
}

function validateNotionArgumentType(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if (schema.type === 'string' && typeof value !== 'string') {
    return `Parameter ${name} must be a string`;
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return `Parameter ${name} must be a boolean`;
  }
  if (schema.type === 'integer' && (typeof value !== 'number' || !Number.isSafeInteger(value))) {
    return `Parameter ${name} must be an integer`;
  }
  if (schema.type === 'array') return validateNotionArrayArgument(name, value, schema.items);
  if (schema.type === 'object' && !isRecord(value)) {
    return `Parameter ${name} must be an object`;
  }
  return undefined;
}

function validateNotionArrayArgument(
  name: string,
  value: unknown,
  items: unknown,
): string | undefined {
  if (!Array.isArray(value)) return `Parameter ${name} must be an array`;
  if (!isRecord(items)) return undefined;
  for (const [index, item] of value.entries()) {
    const error = validateNotionArgument(`${name}[${index}]`, item, items);
    if (error !== undefined) return error;
  }
  return undefined;
}

function validateNotionArgumentConstraints(
  name: string,
  value: unknown,
  schema: Record<string, unknown>,
): string | undefined {
  if ('const' in schema && value !== schema.const) {
    return `Parameter ${name} must be ${JSON.stringify(schema.const)}`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    return `Parameter ${name} must be one of ${schema.enum.join(', ')}`;
  }
  if (typeof schema.minimum === 'number' && typeof value === 'number' && value < schema.minimum) {
    return `Parameter ${name} must be at least ${schema.minimum}`;
  }
  if (typeof schema.maximum === 'number' && typeof value === 'number' && value > schema.maximum) {
    return `Parameter ${name} must be at most ${schema.maximum}`;
  }
  return undefined;
}

function notionToolError(
  message: string,
  code: string,
  status?: number,
  retryAfterSeconds?: number,
): CallToolResult {
  const structuredContent = {
    code,
    ...(status === undefined ? {} : {status}),
    ...(retryAfterSeconds === undefined ? {} : {retryAfterSeconds}),
  };
  return {
    isError: true,
    content: [{type: 'text', text: message}],
    structuredContent,
  };
}

function isObjectNotFound(body: unknown): boolean {
  return isRecord(body) && body.code === 'object_not_found';
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === 'string' ? value : String(value ?? '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
