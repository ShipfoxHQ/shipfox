import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import type {
  AgentToolCallInput,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import {
  type ClaapAgentToolRequiredScope,
  ClaapRecordingUrlError,
  claapAgentToolCatalog,
  claapAgentToolSelectionCatalog,
  isClaapCatalogTool,
  isClaapWorkspaceScopedTool,
  parseClaapRecordingUrl,
} from '#core/agent-tools.js';
import type {ClaapCredentialStore} from '#core/credentials.js';
import {ClaapApiKeyMissingError, ClaapIntegrationProviderError} from '#core/errors.js';
import {
  CLAAP_MCP_CALL_TIMEOUT_MS,
  CLAAP_MCP_DEFAULT_ENDPOINT,
  type CreateClaapMcpClient,
  createClaapMcpClient,
  mapClaapMcpError,
} from '#core/mcp-client.js';
import type {ClaapInstallation} from '#db/installations.js';

type ClaapIntegrationConnection = IntegrationConnection<'claap'>;

const RECORDING_TOOL_IDS = new Set(['get_recording', 'get_recording_transcript']);

export interface ClaapAgentToolsProviderOptions {
  credentialStore: Pick<ClaapCredentialStore, 'getApiKey'>;
  getInstallationByConnectionId: (connectionId: string) => Promise<ClaapInstallation | undefined>;
  markConnectionError: (params: {connectionId: string; credentialVersion: number}) => Promise<void>;
  endpoint?: string | URL | undefined;
  callTimeoutMs?: number | undefined;
  createClient?: CreateClaapMcpClient | undefined;
}

export class ClaapAgentToolsProvider
  implements AgentToolsProvider<ClaapIntegrationConnection, ClaapAgentToolRequiredScope>
{
  private readonly endpoint: URL;
  private readonly callTimeoutMs: number;
  private readonly createClient: CreateClaapMcpClient;

  constructor(private readonly options: ClaapAgentToolsProviderOptions) {
    this.endpoint = new URL(options.endpoint ?? CLAAP_MCP_DEFAULT_ENDPOINT);
    this.callTimeoutMs = options.callTimeoutMs ?? CLAAP_MCP_CALL_TIMEOUT_MS;
    this.createClient = options.createClient ?? createClaapMcpClient;
  }

  catalog() {
    return claapAgentToolCatalog;
  }

  selectionCatalog() {
    return claapAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<ClaapIntegrationConnection, ClaapAgentToolRequiredScope>,
  ): Promise<AgentToolSession<CallToolResult>> {
    const installation = await this.options.getInstallationByConnectionId(input.connection.id);
    if (!installation) throw new Error(`Claap installation not found: ${input.connection.id}`);
    const apiKey = await this.options.credentialStore.getApiKey(input.connection.id);
    if (!apiKey) throw new ClaapApiKeyMissingError(input.connection.id);

    let client: Awaited<ReturnType<CreateClaapMcpClient>>;
    try {
      client = await this.createClient({endpoint: this.endpoint, apiKey});
    } catch (error) {
      const mapped = mapClaapMcpError(error);
      await this.markIfCredentialRejected(mapped, input.connection.id, installation);
      throw mapped;
    }

    return {
      call: async (call) => {
        const upstreamCall = rewriteClaapCall({call, installation});
        try {
          return await client.callTool(upstreamCall, this.callTimeoutMs);
        } catch (error) {
          // Claap answers a revoked key with HTTP 401 on any request, not only at initialize.
          const mapped = mapClaapMcpError(error);
          await this.markIfCredentialRejected(mapped, input.connection.id, installation);
          throw mapped;
        }
      },
      close: () => client.close(),
    };
  }

  // Only an HTTP 401 says the key is bad. An isError result never does: Claap reports a wrong
  // workspace ID the same way. The version guard keeps a late failure from an old key from
  // undoing a replacement.
  private async markIfCredentialRejected(
    error: unknown,
    connectionId: string,
    installation: Pick<ClaapInstallation, 'credentialVersion'>,
  ): Promise<void> {
    if (!(error instanceof ClaapIntegrationProviderError) || error.status !== 401) return;
    // The caller must still see the actionable error when marking the connection fails.
    await this.options
      .markConnectionError({connectionId, credentialVersion: installation.credentialVersion})
      .catch(() => undefined);
  }
}

/**
 * Checks a call against the catalog and turns it into what Claap expects. The key can reach
 * Claap's write tools, so a tool outside the catalog never goes upstream.
 */
export function rewriteClaapCall(params: {
  call: AgentToolCallInput;
  installation: Pick<ClaapInstallation, 'workspaceId' | 'workspaceName'>;
}): AgentToolCallInput {
  const {call, installation} = params;
  if (!isClaapCatalogTool(call.toolId)) {
    throw new ClaapIntegrationProviderError(
      'provider-rejected',
      `${call.toolId} is not a Claap tool that Shipfox exposes.`,
    );
  }
  if (!isClaapWorkspaceScopedTool(call.toolId)) return {toolId: call.toolId, arguments: {}};

  const {recordingUrl, ...rest} = call.arguments;
  let upstreamArguments: Record<string, unknown> = rest;
  if (RECORDING_TOOL_IDS.has(call.toolId)) {
    upstreamArguments = {
      ...rest,
      recordingId: resolveRecordingId({
        recordingId: rest.recordingId,
        recordingUrl,
        installation,
      }),
    };
  }
  return {
    toolId: call.toolId,
    // The connection decides the workspace, never the caller.
    arguments: {...upstreamArguments, workspaceId: installation.workspaceId},
  };
}

function resolveRecordingId(params: {
  recordingId: unknown;
  recordingUrl: unknown;
  installation: Pick<ClaapInstallation, 'workspaceId' | 'workspaceName'>;
}): string {
  const hasId = params.recordingId !== undefined;
  const hasUrl = params.recordingUrl !== undefined;
  if (hasId === hasUrl) {
    throw new ClaapIntegrationProviderError(
      'provider-rejected',
      'Pass exactly one of recordingId and recordingUrl.',
    );
  }
  if (hasId) {
    if (typeof params.recordingId !== 'string' || params.recordingId.length === 0) {
      throw new ClaapIntegrationProviderError(
        'provider-rejected',
        'recordingId must be a non-empty string.',
      );
    }
    return params.recordingId;
  }
  if (typeof params.recordingUrl !== 'string') {
    throw new ClaapIntegrationProviderError('provider-rejected', 'recordingUrl must be a string.');
  }
  try {
    const parsed = parseClaapRecordingUrl(params.recordingUrl);
    if (parsed.workspaceId !== params.installation.workspaceId) {
      throw new ClaapRecordingUrlError(
        `recordingUrl belongs to another Claap workspace. This connection is Claap workspace ${params.installation.workspaceName}.`,
      );
    }
    return parsed.recordingId;
  } catch (error) {
    if (error instanceof ClaapRecordingUrlError) {
      throw new ClaapIntegrationProviderError('provider-rejected', error.message);
    }
    throw error;
  }
}
