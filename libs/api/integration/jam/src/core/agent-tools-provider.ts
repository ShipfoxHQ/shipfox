import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {
  type AgentToolCatalogEntry,
  type AgentToolSession,
  type AgentToolsProvider,
  agentToolResultKind,
  type IntegrationConnection,
  type OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-spi';
import {
  type JamAgentToolRequiredScope,
  jamAgentToolCatalog,
  jamAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import type {JamCredentialStore} from '#core/credentials.js';
import {JamIntegrationProviderError, JamTokenMissingError} from '#core/errors.js';
import {
  type CreateJamMcpClient,
  createSdkJamMcpClient,
  DEFAULT_JAM_MCP_ENDPOINT,
  JAM_MCP_CALL_TIMEOUT_MS,
  type JamMcpClient,
  mapJamMcpError,
} from '#core/mcp-client.js';
import type {JamInstallation} from '#db/installations.js';

const SEARCH_JAMS_TOOL_ID = 'searchJams';
const SEARCH_JAMS_QUERY_VERSION = 1;
// A tool step only reads JSON results, so it cannot call a tool that returns images.
const catalogEntries: readonly AgentToolCatalogEntry[] = jamAgentToolCatalog;
const imageToolIds = new Set(
  catalogEntries.filter((entry) => agentToolResultKind(entry) === 'image').map((entry) => entry.id),
);
const jamNotFoundPattern = /^JamNotFound\b/;

type JamIntegrationConnection = IntegrationConnection<'jam'>;

export interface JamAgentToolsProviderOptions {
  credentialStore: Pick<JamCredentialStore, 'getToken'>;
  getInstallationByConnectionId: (connectionId: string) => Promise<JamInstallation | undefined>;
  markConnectionError: (params: {connectionId: string; credentialVersion: number}) => Promise<void>;
  endpoint?: string | URL | undefined;
  callTimeoutMs?: number | undefined;
  createClient?: CreateJamMcpClient | undefined;
}

export class JamAgentToolsProvider
  implements AgentToolsProvider<JamIntegrationConnection, JamAgentToolRequiredScope>
{
  private readonly endpoint: URL;
  private readonly callTimeoutMs: number;
  private readonly createClient: CreateJamMcpClient;
  private readonly catalogIds = new Set<string>(jamAgentToolCatalog.map((entry) => entry.id));

  constructor(private readonly options: JamAgentToolsProviderOptions) {
    this.endpoint = new URL(options.endpoint ?? DEFAULT_JAM_MCP_ENDPOINT);
    this.callTimeoutMs = options.callTimeoutMs ?? JAM_MCP_CALL_TIMEOUT_MS;
    this.createClient = options.createClient ?? createSdkJamMcpClient;
  }

  catalog() {
    return jamAgentToolCatalog;
  }

  selectionCatalog() {
    return jamAgentToolSelectionCatalog;
  }

  async openSession(
    input: OpenAgentToolsSessionInput<JamIntegrationConnection, JamAgentToolRequiredScope>,
  ): Promise<AgentToolSession<CallToolResult>> {
    const installation = await this.options.getInstallationByConnectionId(input.connection.id);
    if (!installation) throw new Error(`Jam installation not found: ${input.connection.id}`);
    const token = await this.options.credentialStore.getToken(input.connection.id);
    if (!token) throw new JamTokenMissingError(input.connection.id);

    const callerKind = input.caller?.callerKind;

    // A revoked or expired token is rejected with HTTP 401, at initialize or on a later request.
    // The version guard keeps a late failure from an old token from undoing a replacement.
    const mapAndFlag = async (error: unknown): Promise<unknown> => {
      const mapped = mapJamMcpError(error);
      if (mapped instanceof JamIntegrationProviderError && mapped.status === 401) {
        await this.options.markConnectionError({
          connectionId: input.connection.id,
          credentialVersion: installation.credentialVersion,
        });
      }
      return mapped;
    };

    let client: JamMcpClient;
    try {
      client = await this.createClient({endpoint: this.endpoint, accessToken: token});
    } catch (error) {
      throw await mapAndFlag(error);
    }

    return {
      call: async (call) => {
        // The catalog is the safety boundary: Jam lists its write tools for every token.
        if (!this.catalogIds.has(call.toolId)) {
          throw new JamIntegrationProviderError(
            'provider-rejected',
            `${call.toolId} is not a Jam tool that Shipfox offers.`,
          );
        }
        if (callerKind === 'tool_step' && imageToolIds.has(call.toolId)) {
          throw new JamIntegrationProviderError(
            'provider-rejected',
            `${call.toolId} returns images; call it from an agent step.`,
          );
        }
        try {
          return withNotFoundCode(
            await client.callTool(
              call.toolId === SEARCH_JAMS_TOOL_ID
                ? {...call, arguments: {...call.arguments, v: SEARCH_JAMS_QUERY_VERSION}}
                : call,
              this.callTimeoutMs,
            ),
          );
        } catch (error) {
          throw await mapAndFlag(error);
        }
      },
      close: () => client.close(),
    };
  }
}

/** Jam reports a Jam that does not exist, or that the token's user cannot see, as prose. */
function withNotFoundCode(result: CallToolResult): CallToolResult {
  if (result.isError !== true) return result;
  const block = result.content.find((content) => content.type === 'text');
  if (block?.type !== 'text' || !jamNotFoundPattern.test(block.text)) return result;
  return {
    ...result,
    structuredContent: {...result.structuredContent, code: 'not-found'},
  };
}
