import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {type CallToolResult, CallToolResultSchema} from '@modelcontextprotocol/sdk/types.js';
import type {
  AgentToolCallInput,
  AgentToolSession,
  AgentToolsProvider,
  IntegrationConnection,
  OpenAgentToolsSessionInput,
} from '@shipfox/api-integration-core-dto';
import {
  type LinearAgentToolRequiredScope,
  linearAgentToolCatalog,
  linearAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
import type {LinearTokenStore} from '#core/tokens.js';

const LINEAR_MCP_ENDPOINT = 'https://mcp.linear.app/mcp';
const LINEAR_MCP_CALL_TIMEOUT_MS = 30_000;

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
    const client = await this.createClient({endpoint: this.endpoint, accessToken});

    return {
      call: (call) => client.callTool(call, this.callTimeoutMs),
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
