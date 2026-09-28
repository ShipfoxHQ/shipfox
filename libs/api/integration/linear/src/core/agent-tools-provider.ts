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
  AgentToolDownloadFileInput,
  AgentToolFileDownload,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import type {EgressPolicy} from '@shipfox/node-egress-guard';
import {
  type LinearAgentToolRequiredScope,
  linearAgentToolCatalog,
  linearAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import {isLinearNotFoundMessage, LinearIntegrationProviderError} from '#core/errors.js';
import type {LinearTokenStore} from '#core/tokens.js';
import {downloadLinearUpload} from '#core/uploads.js';

const LINEAR_MCP_ENDPOINT = 'https://mcp.linear.app/mcp';
const LINEAR_UPLOADS_URL = 'https://uploads.linear.app/';
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
  uploads?:
    | {
        url?: string | URL | undefined;
        allowPrivateNetworks?: boolean | undefined;
        fetch?: typeof fetch | undefined;
      }
    | undefined;
}

type LinearNativeFileTool = (params: {
  arguments: Record<string, unknown>;
  accessToken: string;
  signal: AbortSignal;
}) => Promise<AgentToolFileDownload>;

export class LinearAgentToolsProvider
  implements AgentToolsProvider<LinearIntegrationConnection, LinearAgentToolRequiredScope>
{
  private readonly endpoint: URL;
  private readonly callTimeoutMs: number;
  private readonly createClient: CreateLinearMcpClient;
  /** Tools served here rather than proxied to the hosted MCP, which has no file downloads. */
  private readonly nativeFileTools: Record<string, LinearNativeFileTool>;

  constructor(private readonly options: LinearAgentToolsProviderOptions) {
    this.endpoint = new URL(options.endpoint ?? LINEAR_MCP_ENDPOINT);
    this.callTimeoutMs = options.callTimeoutMs ?? LINEAR_MCP_CALL_TIMEOUT_MS;
    this.createClient = options.createClient ?? createSdkLinearMcpClient;
    const uploadsUrl = new URL(options.uploads?.url ?? LINEAR_UPLOADS_URL);
    const egressPolicy: EgressPolicy = {
      allowPrivateNetworks: options.uploads?.allowPrivateNetworks ?? false,
    };
    this.nativeFileTools = {
      download_file: (params) =>
        downloadLinearUpload({
          url: params.arguments.url,
          uploadsUrl,
          accessToken: params.accessToken,
          egressPolicy,
          signal: params.signal,
          fetch: options.uploads?.fetch,
        }),
    };
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
        if (Object.hasOwn(this.nativeFileTools, call.toolId)) {
          throw new LinearIntegrationProviderError(
            'provider-rejected',
            `${call.toolId} returns a file. Download it from an action step.`,
          );
        }
        try {
          return withNotFoundCode(await client.callTool(call, this.callTimeoutMs));
        } catch (error) {
          throw mapLinearMcpError(error);
        }
      },
      close: () => client.close(),
    };
  }

  async downloadFile(
    input: AgentToolDownloadFileInput<LinearIntegrationConnection>,
  ): Promise<AgentToolFileDownload> {
    const tool = Object.hasOwn(this.nativeFileTools, input.toolId)
      ? this.nativeFileTools[input.toolId]
      : undefined;
    if (tool === undefined) {
      throw new LinearIntegrationProviderError(
        'provider-rejected',
        `${input.toolId} does not return a file.`,
      );
    }
    const accessToken = await this.options.tokenStore.getAccessToken({
      connectionId: input.connection.id,
    });
    try {
      return await tool({arguments: input.arguments, accessToken, signal: input.signal});
    } catch (error) {
      throw mapLinearMcpError(error);
    }
  }
}

/** Linear's hosted MCP reports missing records as prose without an error code. */
function withNotFoundCode(result: CallToolResult): CallToolResult {
  if (result.isError !== true) return result;
  const message = mcpErrorMessage(result);
  if (message === undefined || !isLinearNotFoundMessage(message)) return result;
  return {
    ...result,
    structuredContent: {...result.structuredContent, code: 'not-found'},
  };
}

function mcpErrorMessage(result: CallToolResult): string | undefined {
  const block = result.content.find((content) => content.type === 'text');
  if (block?.type !== 'text') return undefined;
  try {
    const parsed: unknown = JSON.parse(block.text);
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
      return typeof parsed.message === 'string' ? parsed.message : undefined;
    }
  } catch {
    // Some Linear tools return plain prose rather than a JSON error object.
  }
  return block.text;
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
