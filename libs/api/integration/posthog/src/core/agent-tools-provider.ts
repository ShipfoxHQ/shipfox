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
import type {PosthogApiClient} from '#api/client.js';
import {
  type PosthogAgentToolRequiredScope,
  posthogAgentToolCatalog,
  posthogAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import type {PosthogCredentialStore} from '#core/credentials.js';
import {PosthogApiKeyMissingError, PosthogIntegrationProviderError} from '#core/errors.js';
import type {PosthogInstallation} from '#db/installations.js';

const POSTHOG_MCP_ENDPOINTS = {
  us: 'https://mcp.posthog.com/mcp',
  eu: 'https://mcp-eu.posthog.com/mcp',
} as const;
const POSTHOG_MCP_CALL_TIMEOUT_MS = 30_000;
const timeoutNamePattern = /timed?\s*out|timeout/i;
const networkFailureMessagePattern = /^(fetch failed|failed to fetch|network error)$/i;
const networkFailureCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET']);
const invalidApiKeyHint = 'INVALID_API_KEY';

type PosthogIntegrationConnection = IntegrationConnection<'posthog'>;

interface PosthogMcpClient {
  callTool(input: AgentToolCallInput, timeoutMs: number): Promise<CallToolResult>;
  close(): Promise<void>;
}

export interface CreatePosthogMcpClientParams {
  endpoint: URL;
  accessToken: string;
  headers: Record<string, string>;
}

export type CreatePosthogMcpClient = (
  params: CreatePosthogMcpClientParams,
) => Promise<PosthogMcpClient>;

export interface PosthogAgentToolsProviderOptions {
  credentialStore: Pick<PosthogCredentialStore, 'getApiKey'>;
  getInstallationByConnectionId: (connectionId: string) => Promise<PosthogInstallation | undefined>;
  api: Pick<PosthogApiClient, 'probeCredential'>;
  markConnectionError: (params: {connectionId: string; credentialVersion: number}) => Promise<void>;
  endpoint?: string | URL | undefined;
  callTimeoutMs?: number | undefined;
  createClient?: CreatePosthogMcpClient | undefined;
}

export class PosthogAgentToolsProvider
  implements AgentToolsProvider<PosthogIntegrationConnection, PosthogAgentToolRequiredScope>
{
  private readonly endpoint: URL | undefined;
  private readonly callTimeoutMs: number;
  private readonly createClient: CreatePosthogMcpClient;

  constructor(private readonly options: PosthogAgentToolsProviderOptions) {
    this.endpoint = options.endpoint === undefined ? undefined : new URL(options.endpoint);
    this.callTimeoutMs = options.callTimeoutMs ?? POSTHOG_MCP_CALL_TIMEOUT_MS;
    this.createClient = options.createClient ?? createSdkPosthogMcpClient;
  }

  catalog() {
    return posthogAgentToolCatalog;
  }

  selectionCatalog() {
    return posthogAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<PosthogIntegrationConnection, PosthogAgentToolRequiredScope>,
  ): Promise<AgentToolSession<CallToolResult>> {
    const installation = await this.options.getInstallationByConnectionId(input.connection.id);
    if (!installation) {
      throw new Error(`PostHog installation not found: ${input.connection.id}`);
    }
    const apiKey = await this.options.credentialStore.getApiKey(input.connection.id);
    if (!apiKey) throw new PosthogApiKeyMissingError(input.connection.id);

    let client: PosthogMcpClient;
    try {
      client = await this.createClient({
        endpoint: this.endpoint ?? new URL(POSTHOG_MCP_ENDPOINTS[installation.region]),
        accessToken: apiKey,
        headers: posthogHeaders(installation),
      });
    } catch (error) {
      const mapped = mapPosthogMcpError(error);
      if (mapped instanceof PosthogIntegrationProviderError && mapped.status === 401) {
        await this.options.markConnectionError({
          connectionId: input.connection.id,
          credentialVersion: installation.credentialVersion,
        });
      }
      throw mapped;
    }

    return {
      call: async (call) => {
        try {
          const result = await client.callTool(call, this.callTimeoutMs);
          if (result.isError === true) {
            await this.confirmCredentialFailure({
              connectionId: input.connection.id,
              credentialVersion: installation.credentialVersion,
              region: installation.region,
              apiKey,
              result,
            });
            return genericPosthogToolError(result);
          }
          return result;
        } catch (error) {
          throw mapPosthogMcpError(error);
        }
      },
      close: () => client.close(),
    };
  }

  private async confirmCredentialFailure(params: {
    connectionId: string;
    credentialVersion: number;
    region: PosthogInstallation['region'];
    apiKey: string;
    result: CallToolResult;
  }): Promise<void> {
    const text = params.result.content
      .filter((item): item is {type: 'text'; text: string} => item.type === 'text')
      .map((item) => item.text)
      .join('\n');
    if (!text.includes(invalidApiKeyHint)) return;

    let probe: Awaited<ReturnType<PosthogApiClient['probeCredential']>>;
    try {
      probe = await this.options.api.probeCredential({
        region: params.region,
        apiKey: params.apiKey,
      });
    } catch {
      return;
    }
    if (probe.status !== 401) return;
    await this.options.markConnectionError({
      connectionId: params.connectionId,
      credentialVersion: params.credentialVersion,
    });
  }
}

function posthogHeaders(installation: PosthogInstallation): Record<string, string> {
  return {
    'x-posthog-mcp-mode': 'tools',
    'x-posthog-read-only': 'true',
    'x-posthog-project-id': installation.projectId,
    'x-posthog-organization-id': installation.organizationId,
  };
}

async function createSdkPosthogMcpClient(
  params: CreatePosthogMcpClientParams,
): Promise<PosthogMcpClient> {
  const client = new Client({name: 'shipfox-posthog-tools', version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(params.endpoint, {
    requestInit: {
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        ...params.headers,
      },
    },
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

function genericPosthogToolError(result: CallToolResult): CallToolResult {
  return {
    isError: true,
    content: result.content,
  };
}

function mapPosthogMcpError(error: unknown): unknown {
  if (error instanceof PosthogIntegrationProviderError) return error;
  if (error instanceof StreamableHTTPError) return mapPosthogMcpHttpError(error);
  if (error instanceof McpError) {
    if (error.code === ErrorCode.RequestTimeout) {
      return new PosthogIntegrationProviderError('timeout', 'PostHog timed out. Please try again.');
    }
    if (error.code === ErrorCode.ConnectionClosed || error.code === ErrorCode.InternalError) {
      return posthogUnavailable();
    }
    if (
      error.code === ErrorCode.InvalidRequest ||
      error.code === ErrorCode.MethodNotFound ||
      error.code === ErrorCode.InvalidParams
    ) {
      return new PosthogIntegrationProviderError(
        'provider-rejected',
        'PostHog rejected the request.',
      );
    }
    return error;
  }
  if (isNetworkTimeout(error)) {
    return new PosthogIntegrationProviderError('timeout', 'PostHog timed out. Please try again.');
  }
  if (isNetworkFailure(error)) return posthogUnavailable();
  return error;
}

function mapPosthogMcpHttpError(error: StreamableHTTPError): PosthogIntegrationProviderError {
  const status = httpStatus(error.code);
  if (status === 401) {
    return new PosthogIntegrationProviderError(
      'credentials-unavailable',
      'PostHog credentials are unavailable. Replace the API key and try again.',
      undefined,
      status,
    );
  }
  if (status === 429) {
    return new PosthogIntegrationProviderError(
      'rate-limited',
      'PostHog rate limited the request. Please try again later.',
      undefined,
      status,
    );
  }
  if (status === 408) {
    return new PosthogIntegrationProviderError(
      'timeout',
      'PostHog timed out. Please try again.',
      undefined,
      status,
    );
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new PosthogIntegrationProviderError(
      'provider-rejected',
      status === 403
        ? 'PostHog rejected the request because the key does not have the required permission.'
        : 'PostHog rejected the request.',
      undefined,
      status,
    );
  }
  return posthogUnavailable(status);
}

function posthogUnavailable(status?: number): PosthogIntegrationProviderError {
  return new PosthogIntegrationProviderError(
    'provider-unavailable',
    'PostHog is temporarily unavailable. Please try again.',
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
