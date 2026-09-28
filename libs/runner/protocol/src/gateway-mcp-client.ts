import {AsyncLocalStorage} from 'node:async_hooks';
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

export interface GatewayMcpRequestOptions extends RequestOptions {
  /** Extra HTTP headers for this request only, such as `x-shipfox-call-id`. */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface GatewayMcpClient {
  listTools(
    params?: ListToolsRequest['params'],
    options?: GatewayMcpRequestOptions,
  ): Promise<ListToolsResult>;
  callTool(
    params: CallToolRequest['params'],
    options?: GatewayMcpRequestOptions,
  ): Promise<CallToolResult>;
  close(): Promise<void>;
}

interface RequestScope {
  readonly signal: AbortSignal | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;
}

/**
 * Connects lazily to the integration tools gateway and shares one connection between concurrent
 * callers. Each request's signal and headers reach only that request's HTTP fetch, so cancelling
 * one call never aborts another. The gateway is stateless, so a failed request leaves the
 * connection usable; only a failed connect replaces it.
 */
export function createGatewayMcpClient(params: {
  url: URL;
  fetch: typeof fetch;
  name: string;
}): GatewayMcpClient {
  const requestScope = new AsyncLocalStorage<RequestScope>();
  const scopedFetch: typeof fetch = (input, init) => {
    const scope = requestScope.getStore();
    if (scope === undefined) return params.fetch(input, init);
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(scope.headers ?? {})) headers.set(key, value);
    const signals = [init?.signal, scope.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined && signal !== null,
    );
    return params.fetch(input, {
      ...init,
      headers,
      ...(signals.length === 0 ? {} : {signal: AbortSignal.any(signals)}),
    });
  };
  const createClient = () => new Client({name: params.name, version: '0.0.0'});
  const createTransport = () => new StreamableHTTPClientTransport(params.url, {fetch: scopedFetch});
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

  // The shared connect runs outside every caller's scope, so no caller's signal or headers
  // reach the initialize request.
  const ensureConnected = async () => {
    if (closed) throw new Error('Gateway MCP client is closed.');
    await resetPromise;
    if (closed) throw new Error('Gateway MCP client is closed.');
    if (connectPromise !== undefined) return connectPromise;

    const connectingClient = client;
    const connectingTransport = transport;
    let pendingConnection: Promise<void>;
    pendingConnection = requestScope
      .exit(() => connectingClient.connect(connectingTransport as unknown as Transport))
      .catch(async (error: unknown) => {
        if (connectPromise === pendingConnection) connectPromise = undefined;
        await resetConnection(connectingClient);
        throw error;
      });
    connectPromise = pendingConnection;
    return pendingConnection;
  };

  const withClient = async <T>(
    options: GatewayMcpRequestOptions | undefined,
    request: (requestClient: Client, requestOptions: RequestOptions | undefined) => Promise<T>,
  ): Promise<T> => {
    await ensureConnected();
    const {headers, ...requestOptions} = options ?? {};
    return await requestScope.run({signal: requestOptions.signal, headers}, () =>
      request(client, options === undefined ? undefined : requestOptions),
    );
  };

  return {
    listTools(listParams, options) {
      return withClient(options, (requestClient, requestOptions) =>
        requestClient.listTools(listParams, requestOptions),
      );
    },
    callTool(callParams, options) {
      return withClient(
        options,
        async (requestClient, requestOptions) =>
          (await requestClient.callTool(
            callParams,
            CallToolResultSchema,
            requestOptions,
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
