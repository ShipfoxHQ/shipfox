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
import {JamIntegrationProviderError} from '#core/errors.js';

export const DEFAULT_JAM_MCP_ENDPOINT = 'https://mcp.jam.dev/mcp';
export const JAM_MCP_CALL_TIMEOUT_MS = 30_000;

const timeoutNamePattern = /timed?\s*out|timeout/i;
const networkFailureMessagePattern = /^(fetch failed|failed to fetch|network error)$/i;
const networkFailureCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET']);

export interface JamMcpClient {
  callTool(input: AgentToolCallInput, timeoutMs: number): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface CreateJamMcpClientParams {
  endpoint: URL;
  accessToken: string;
}

export type CreateJamMcpClient = (params: CreateJamMcpClientParams) => Promise<JamMcpClient>;

export async function createSdkJamMcpClient(
  params: CreateJamMcpClientParams,
): Promise<JamMcpClient> {
  const client = new Client({name: 'shipfox-jam-tools', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(params.endpoint, {
    requestInit: {headers: {authorization: `Bearer ${params.accessToken}`}},
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

export function mapJamMcpError(error: unknown): unknown {
  if (error instanceof JamIntegrationProviderError) return error;
  if (error instanceof StreamableHTTPError) return mapJamMcpHttpError(error);
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) {
      return new JamIntegrationProviderError('timeout', 'Jam timed out. Please try again.');
    }
    if (error.code === ErrorCode.ConnectionClosed || error.code === ErrorCode.InternalError) {
      return jamUnavailable();
    }
    if (
      error.code === ErrorCode.InvalidRequest ||
      error.code === ErrorCode.MethodNotFound ||
      error.code === ErrorCode.InvalidParams
    ) {
      return new JamIntegrationProviderError('provider-rejected', 'Jam rejected the request.');
    }
    return error;
  }
  if (isNetworkTimeout(error)) {
    return new JamIntegrationProviderError('timeout', 'Jam timed out. Please try again.');
  }
  if (isNetworkFailure(error)) return jamUnavailable();
  return error;
}

function mapJamMcpHttpError(error: StreamableHTTPError): JamIntegrationProviderError {
  const status = httpStatus(error.code);
  if (status === 401) {
    return new JamIntegrationProviderError(
      'credentials-unavailable',
      'Jam credentials are unavailable. Replace the token and try again.',
      undefined,
      status,
    );
  }
  if (status === 429) {
    return new JamIntegrationProviderError(
      'rate-limited',
      'Jam rate limited the request. Please try again later.',
      undefined,
      status,
    );
  }
  if (status === 408) {
    return new JamIntegrationProviderError(
      'timeout',
      'Jam timed out. Please try again.',
      undefined,
      status,
    );
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new JamIntegrationProviderError(
      'provider-rejected',
      status === 403
        ? 'Jam rejected the request because the token does not have the required permission.'
        : 'Jam rejected the request.',
      undefined,
      status,
    );
  }
  return jamUnavailable(status);
}

export function jamUnavailable(status?: number): JamIntegrationProviderError {
  return new JamIntegrationProviderError(
    'provider-unavailable',
    'Jam is temporarily unavailable. Please try again.',
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
