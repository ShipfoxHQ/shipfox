import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  CallToolResultSchema,
  ListToolsRequestSchema,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';

export interface IntegrationToolsBridge {
  readonly name: string;
  readonly server: Server;
  listTools(): Promise<ListToolsResult>;
  callTool(name: string, args?: Record<string, unknown>): Promise<CallToolResult>;
  close(): Promise<void>;
}

export function createIntegrationToolsBridge(params: {
  url: URL;
  fetch: typeof fetch;
  name: string;
}): IntegrationToolsBridge {
  const client = new Client({name: params.name, version: '0.0.0'});
  const transport = new StreamableHTTPClientTransport(params.url, {fetch: params.fetch});
  const server = new Server({name: params.name, version: '0.0.0'}, {capabilities: {tools: {}}});
  let connectPromise: Promise<void> | undefined;

  const ensureConnected = () => {
    connectPromise ??= client.connect(transport as unknown as Transport);
    return connectPromise;
  };

  const bridge: IntegrationToolsBridge = {
    name: params.name,
    server,
    async listTools() {
      await ensureConnected();
      return client.listTools();
    },
    async callTool(name, args) {
      await ensureConnected();
      return client.callTool(
        {name, ...(args === undefined ? {} : {arguments: args})},
        CallToolResultSchema,
      ) as Promise<CallToolResult>;
    },
    async close() {
      await client.close();
      await server.close();
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    await ensureConnected();
    return client.listTools(request.params);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    await ensureConnected();
    return client.callTool(request.params, CallToolResultSchema);
  });

  return bridge;
}
