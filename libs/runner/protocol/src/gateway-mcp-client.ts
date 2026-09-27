import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {RequestOptions} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type CallToolRequest,
  type CallToolResult,
  CallToolResultSchema,
  type ListToolsRequest,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js';

export interface GatewayMcpClient {
  listTools(
    params?: ListToolsRequest['params'],
    options?: RequestOptions,
  ): Promise<ListToolsResult>;
  callTool(params: CallToolRequest['params'], options?: RequestOptions): Promise<CallToolResult>;
  close(): Promise<void>;
}

/**
 * Connects lazily to the integration tools gateway and replaces the MCP client after any failed
 * request, so one failure never leaves a broken session behind for the next call.
 */
export function createGatewayMcpClient(params: {
  url: URL;
  fetch: typeof fetch;
  name: string;
}): GatewayMcpClient {
  const createClient = () => new Client({name: params.name, version: '0.0.0'});
  const createTransport = () =>
    new StreamableHTTPClientTransport(params.url, {fetch: params.fetch});
  let client = createClient();
  let transport = createTransport();
  let connectPromise: Promise<void> | undefined;
  let resetPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let closed = false;

  const resetConnection = (failedClient: Client): Promise<void> => {
    if (closed || client !== failedClient) return Promise.resolve();
    resetPromise ??= (async () => {
      connectPromise = undefined;
      await failedClient.close().catch(() => undefined);
      if (!closed && client === failedClient) {
        client = createClient();
        transport = createTransport();
      }
    })().finally(() => {
      resetPromise = undefined;
    });
    return resetPromise;
  };

  const ensureConnected = async (options?: RequestOptions) => {
    if (closed) throw new Error('Gateway MCP client is closed.');
    await resetPromise;
    if (closed) throw new Error('Gateway MCP client is closed.');
    if (connectPromise !== undefined) return connectPromise;

    const connectingClient = client;
    const connectingTransport = transport;
    let pendingConnection: Promise<void>;
    pendingConnection = connectingClient
      .connect(connectingTransport as unknown as Transport, options)
      .catch(async (error: unknown) => {
        if (connectPromise === pendingConnection) connectPromise = undefined;
        await resetConnection(connectingClient);
        throw error;
      });
    connectPromise = pendingConnection;
    return pendingConnection;
  };

  const withClient = async <T>(
    options: RequestOptions | undefined,
    request: (requestClient: Client) => Promise<T>,
  ): Promise<T> => {
    await ensureConnected(options);
    const requestClient = client;
    try {
      return await request(requestClient);
    } catch (error) {
      await resetConnection(requestClient);
      throw error;
    }
  };

  return {
    listTools(listParams, options) {
      return withClient(options, (requestClient) => requestClient.listTools(listParams, options));
    },
    callTool(callParams, options) {
      return withClient(
        options,
        async (requestClient) =>
          (await requestClient.callTool(
            callParams,
            CallToolResultSchema,
            options,
          )) as CallToolResult,
      );
    },
    close() {
      closed = true;
      closePromise ??= client.close();
      return closePromise;
    },
  };
}
