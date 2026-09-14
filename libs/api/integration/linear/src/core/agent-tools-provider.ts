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
import type {
  AgentToolCallInput,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import {
  type LinearAgentToolRequiredScope,
  linearAgentToolCatalog,
  linearAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import {LinearIntegrationProviderError} from '#core/errors.js';
import type {LinearTokenStore} from '#core/tokens.js';

const LINEAR_MCP_ENDPOINT = 'https://mcp.linear.app/mcp';
const LINEAR_MCP_CALL_TIMEOUT_MS = 30_000;
const timeoutNamePattern = /timed?\s*out|timeout/i;
const networkFailureMessagePattern = /^(fetch failed|failed to fetch|network error)$/i;
const networkFailureCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET']);

type LinearIntegrationConnection = IntegrationConnection<'linear'>;

interface LinearMcpClient {
  callTool(input: AgentToolCallInput, timeoutMs: number): Promise<CallToolResult>;
  close(): Promise<void>;
}

interface CreateLinearMcpClientParams {
  endpoint: URL;
  accessToken: string;
}

type CreateLinearMcpClient = (params: CreateLinearMcpClientParams) => Promise<LinearMcpClient>;

export interface LinearAgentToolsProviderOptions {
  tokenStore: Pick<LinearTokenStore, 'getAccessToken'>;
  endpoint?: string | URL | undefined;
  callTimeoutMs?: number | undefined;
  createClient?: CreateLinearMcpClient | undefined;
}

export class LinearAgentToolsProvider
  implements AgentToolsProvider<LinearIntegrationConnection, LinearAgentToolRequiredScope>
{
  private readonly endpoint: URL;
  private readonly callTimeoutMs: number;
  private readonly createClient: CreateLinearMcpClient;

  constructor(private readonly options: LinearAgentToolsProviderOptions) {
    this.endpoint = new URL(options.endpoint ?? LINEAR_MCP_ENDPOINT);
    this.callTimeoutMs = options.callTimeoutMs ?? LINEAR_MCP_CALL_TIMEOUT_MS;
    this.createClient = options.createClient ?? createSdkLinearMcpClient;
  }

  catalog() {
    return linearAgentToolCatalog;
  }

  selectionCatalog() {
    return linearAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<LinearIntegrationConnection, LinearAgentToolRequiredScope>,
  ): Promise<AgentToolSession<CallToolResult>> {
    const accessToken = await this.options.tokenStore.getAccessToken({
      connectionId: input.connection.id,
    });
    let client: LinearMcpClient;
    try {
      client = await this.createClient({endpoint: this.endpoint, accessToken});
    } catch (error) {
      throw mapLinearMcpError(error);
    }

    return {
      call: async (call) => {
        try {
          return await client.callTool(call, this.callTimeoutMs);
        } catch (error) {
          throw mapLinearMcpError(error);
        }
      },
      close: () => client.close(),
    };
  }
}

async function createSdkLinearMcpClient(
  params: CreateLinearMcpClientParams,
): Promise<LinearMcpClient> {
  const client = new Client({name: 'shipfox-linear-tools', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(params.endpoint, {
    requestInit: {
      headers: {authorization: `Bearer ${params.accessToken}`},
    },
  });

  await client.connect(transport as unknown as Transport);

  return {
    callTool: async (input, timeoutMs) => {
      const result = await client.callTool(
        {name: input.toolId, arguments: input.arguments},
        CallToolResultSchema,
        {
          timeout: timeoutMs,
        },
      );
      return result as CallToolResult;
    },
    close: async () => {
      await client.close();
    },
  };
}

function mapLinearMcpError(error: unknown): unknown {
  if (error instanceof LinearIntegrationProviderError) return error;
  if (error instanceof StreamableHTTPError) return mapLinearMcpHttpError(error);
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) {
      return new LinearIntegrationProviderError('timeout', 'Linear timed out. Please try again.');
    }
    if (error.code === ErrorCode.ConnectionClosed || error.code === ErrorCode.InternalError) {
      return linearUnavailable();
    }
    if (
      error.code === ErrorCode.InvalidRequest ||
      error.code === ErrorCode.MethodNotFound ||
      error.code === ErrorCode.InvalidParams
    ) {
      return new LinearIntegrationProviderError(
        'provider-rejected',
        'Linear rejected the request.',
      );
    }
    return error;
  }
  if (isNetworkTimeout(error)) {
    return new LinearIntegrationProviderError('timeout', 'Linear timed out. Please try again.');
  }
  if (isNetworkFailure(error)) return linearUnavailable();
  return error;
}

function mapLinearMcpHttpError(error: StreamableHTTPError): LinearIntegrationProviderError {
  const status = httpStatus(error.code);
  if (status === 401) {
    return new LinearIntegrationProviderError(
      'credentials-unavailable',
      'Linear credentials are unavailable. Reconnect Linear and try again.',
      undefined,
      status,
    );
  }
  if (status === 429) {
    return new LinearIntegrationProviderError(
      'rate-limited',
      'Linear rate limited the request. Please try again later.',
      undefined,
      status,
    );
  }
  if (status === 408) {
    return new LinearIntegrationProviderError(
      'timeout',
      'Linear timed out. Please try again.',
      undefined,
      status,
    );
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new LinearIntegrationProviderError(
      'provider-rejected',
      'Linear rejected the request.',
      undefined,
      status,
    );
  }
  return linearUnavailable(status);
}

function linearUnavailable(status?: number | undefined): LinearIntegrationProviderError {
  return new LinearIntegrationProviderError(
    'provider-unavailable',
    'Linear is temporarily unavailable. Please try again.',
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
