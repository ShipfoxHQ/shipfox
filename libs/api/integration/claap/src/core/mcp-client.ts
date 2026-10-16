import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type CallToolResult,
  CallToolResultSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type {AgentToolCallInput} from '@shipfox/api-integration-spi';
import {ClaapIntegrationProviderError, ClaapInvalidApiKeyError} from './errors.js';

export const CLAAP_MCP_DEFAULT_ENDPOINT = 'https://api.claap.io/mcp';
export const CLAAP_MCP_CALL_TIMEOUT_MS = 30_000;
const LIST_WORKSPACES_TOOL_ID = 'list_workspaces';

const timeoutNamePattern = /timed?\s*out|timeout/i;
const networkFailureMessagePattern = /^(fetch failed|failed to fetch|network error)$/i;
const networkFailureCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET']);

export interface ClaapMcpClient {
  callTool(input: AgentToolCallInput, timeoutMs: number): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface CreateClaapMcpClientParams {
  endpoint: URL;
  apiKey: string;
}

export type CreateClaapMcpClient = (params: CreateClaapMcpClientParams) => Promise<ClaapMcpClient>;

export interface ClaapWorkspace {
  workspaceId: string;
  name: string;
}

export async function createClaapMcpClient(
  params: CreateClaapMcpClientParams,
): Promise<ClaapMcpClient> {
  const client = new Client({name: 'shipfox-claap-tools', version: '0.0.0'});
  // Claap's MCP takes the key as a bearer token. Its REST API uses `X-Claap-Key` instead.
  const transport = new StreamableHTTPClientTransport(params.endpoint, {
    requestInit: {headers: {authorization: `Bearer ${params.apiKey}`}},
  });

  await client.connect(transport as unknown as Transport);

  return {
    callTool: async (input, timeoutMs) => {
      const result = await client.callTool(
        {name: input.toolId, arguments: input.arguments},
        CallToolResultSchema,
        {timeout: timeoutMs},
      );
      return result as CallToolResult;
    },
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Asks Claap which workspaces a key belongs to. Connect and key replacement use it as their only
 * probe. An HTTP 401 or 403 means Claap does not accept the key.
 */
export async function listClaapWorkspaces(params: {
  endpoint: URL;
  apiKey: string;
  createClient?: CreateClaapMcpClient | undefined;
  timeoutMs?: number | undefined;
}): Promise<ClaapWorkspace[]> {
  const createClient = params.createClient ?? createClaapMcpClient;
  let client: ClaapMcpClient;
  try {
    client = await createClient({endpoint: params.endpoint, apiKey: params.apiKey});
  } catch (error) {
    throw mapProbeError(error);
  }
  try {
    const result = await client.callTool(
      {toolId: LIST_WORKSPACES_TOOL_ID, arguments: {}},
      params.timeoutMs ?? CLAAP_MCP_CALL_TIMEOUT_MS,
    );
    if (result.isError === true) {
      throw new ClaapIntegrationProviderError('provider-rejected', 'Claap rejected the request.');
    }
    return parseWorkspaces(result);
  } catch (error) {
    throw mapProbeError(error);
  } finally {
    await client.close().catch(() => undefined);
  }
}

function mapProbeError(error: unknown): unknown {
  if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) {
    return new ClaapInvalidApiKeyError();
  }
  return mapClaapMcpError(error);
}

function parseWorkspaces(result: CallToolResult): ClaapWorkspace[] {
  const payload = result.structuredContent ?? parseTextContent(result);
  const workspaces =
    typeof payload === 'object' && payload !== null && 'workspaces' in payload
      ? payload.workspaces
      : undefined;
  if (!Array.isArray(workspaces)) throw malformedResponse();
  return workspaces.map((workspace: unknown) => {
    if (
      typeof workspace !== 'object' ||
      workspace === null ||
      !('workspaceId' in workspace) ||
      !('name' in workspace) ||
      typeof workspace.workspaceId !== 'string' ||
      typeof workspace.name !== 'string'
    ) {
      throw malformedResponse();
    }
    return {workspaceId: workspace.workspaceId, name: workspace.name};
  });
}

function parseTextContent(result: CallToolResult): unknown {
  const text = result.content
    .filter((item): item is {type: 'text'; text: string} => item.type === 'text')
    .map((item) => item.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch {
    throw malformedResponse();
  }
}

function malformedResponse(): ClaapIntegrationProviderError {
  return new ClaapIntegrationProviderError(
    'malformed-provider-response',
    'Claap returned a response that Shipfox could not read.',
  );
}

export function mapClaapMcpError(error: unknown): unknown {
  if (error instanceof ClaapIntegrationProviderError) return error;
  if (error instanceof StreamableHTTPError) return mapClaapMcpHttpError(error);
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) {
      return new ClaapIntegrationProviderError('timeout', 'Claap timed out. Please try again.');
    }
    if (error.code === ErrorCode.ConnectionClosed || error.code === ErrorCode.InternalError) {
      return claapUnavailable();
    }
    if (
      error.code === ErrorCode.InvalidRequest ||
      error.code === ErrorCode.MethodNotFound ||
      error.code === ErrorCode.InvalidParams
    ) {
      return new ClaapIntegrationProviderError('provider-rejected', 'Claap rejected the request.');
    }
    return error;
  }
  if (isNetworkTimeout(error)) {
    return new ClaapIntegrationProviderError('timeout', 'Claap timed out. Please try again.');
  }
  if (isNetworkFailure(error)) return claapUnavailable();
  return error;
}

function mapClaapMcpHttpError(error: StreamableHTTPError): ClaapIntegrationProviderError {
  const status = httpStatus(error.code);
  if (status === 401) {
    return new ClaapIntegrationProviderError(
      'credentials-unavailable',
      'Claap credentials are unavailable. Replace the API key and try again.',
      undefined,
      status,
    );
  }
  if (status === 429) {
    return new ClaapIntegrationProviderError(
      'rate-limited',
      'Claap rate limited the request. Please try again later.',
      undefined,
      status,
    );
  }
  if (status === 408) {
    return new ClaapIntegrationProviderError(
      'timeout',
      'Claap timed out. Please try again.',
      undefined,
      status,
    );
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new ClaapIntegrationProviderError(
      'provider-rejected',
      status === 403
        ? 'Claap rejected the request because the key does not have the required permission.'
        : 'Claap rejected the request.',
      undefined,
      status,
    );
  }
  return claapUnavailable(status);
}

function claapUnavailable(status?: number): ClaapIntegrationProviderError {
  return new ClaapIntegrationProviderError(
    'provider-unavailable',
    'Claap is temporarily unavailable. Please try again.',
    undefined,
    status,
  );
}

function httpStatus(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}

function isNetworkTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (timeoutNamePattern.test(error.name)) return true;
  return (
    networkErrorCode(error) === 'ETIMEDOUT' || networkErrorCode(error) === 'UND_ERR_CONNECT_TIMEOUT'
  );
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = networkErrorCode(error);
  return (
    (error instanceof TypeError && networkFailureMessagePattern.test(error.message)) ||
    (code !== undefined && networkFailureCodes.has(code))
  );
}

function networkErrorCode(error: Error): string | undefined {
  if (typeof error.cause !== 'object' || error.cause === null || !('code' in error.cause)) {
    return undefined;
  }
  return typeof error.cause.code === 'string' ? error.cause.code : undefined;
}
