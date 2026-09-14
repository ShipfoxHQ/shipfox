import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {StreamableHTTPError} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {type CallToolResult, ErrorCode, McpError} from '@modelcontextprotocol/sdk/types.js';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {linearAgentToolCatalog, linearAgentToolSelectionCatalog} from '#core/agent-tools.js';
import {LinearAgentToolsProvider} from '#core/agent-tools-provider.js';
import {LinearAccessTokenMissingError, LinearIntegrationProviderError} from '#core/errors.js';

function linearConnection(
  overrides: Partial<IntegrationConnection<'linear'>> = {},
): IntegrationConnection<'linear'> {
  const now = new Date();
  return {
    id: 'linear-connection-1',
    workspaceId: 'workspace-1',
    provider: 'linear',
    externalAccountId: 'linear-org-1',
    slug: 'linear-main',
    displayName: 'Linear',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
    repositoryAccessMode: overrides.repositoryAccessMode ?? 'selected',
  };
}

describe('LinearAgentToolsProvider', () => {
  it('returns the Linear agent tools catalogs', () => {
    const provider = new LinearAgentToolsProvider({
      tokenStore: {getAccessToken: async () => 'linear-token'},
    });

    expect(provider.catalog()).toBe(linearAgentToolCatalog);
    expect(provider.selectionCatalog()).toBe(linearAgentToolSelectionCatalog);
  });

  it('reads the stored token for the connection id before opening the MCP client', async () => {
    const getAccessToken = vi.fn().mockResolvedValue('linear-token');
    const createClient = vi.fn().mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({content: []}),
      close: vi.fn().mockResolvedValue(undefined),
    });
    const provider = new LinearAgentToolsProvider({
      tokenStore: {getAccessToken},
      createClient,
    });

    await provider.openSession({
      connection: linearConnection({id: 'linear-connection-7'}),
      tools: [],
      scope: {provider: 'linear'},
    });

    expect(getAccessToken).toHaveBeenCalledWith({connectionId: 'linear-connection-7'});
    expect(createClient).toHaveBeenCalledWith({
      endpoint: new URL('https://mcp.linear.app/mcp'),
      accessToken: 'linear-token',
    });
  });

  it('sends bearer auth to the remote Streamable HTTP MCP server', async () => {
    const authorizations: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      authorizations.push(request.headers.authorization);
      handleMcpRequest(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    const provider = new LinearAgentToolsProvider({
      tokenStore: {getAccessToken: async () => 'linear-token'},
      endpoint: new URL(`http://127.0.0.1:${address.port}/mcp`),
    });

    try {
      const session = await provider.openSession({
        connection: linearConnection(),
        tools: [],
        scope: {provider: 'linear'},
      });
      const result = await session.call({toolId: 'get_issue', arguments: {id: 'ENG-875'}});
      await session.close?.();

      expect(result.structuredContent).toEqual({tool: 'get_issue'});
      expect(authorizations.every((authorization) => authorization === 'Bearer linear-token')).toBe(
        true,
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('proxies read and write tool calls through the MCP client with the configured timeout', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        content: [{type: 'text', text: 'issue'}],
        structuredContent: {id: 'ENG-875'},
      } satisfies CallToolResult)
      .mockResolvedValueOnce({
        content: [{type: 'text', text: 'comment saved'}],
        structuredContent: {id: 'comment-1'},
      } satisfies CallToolResult);
    const close = vi.fn().mockResolvedValue(undefined);
    const provider = new LinearAgentToolsProvider({
      tokenStore: {getAccessToken: async () => 'linear-token'},
      callTimeoutMs: 1234,
      createClient: async () => ({callTool, close}),
    });
    const session = await provider.openSession({
      connection: linearConnection(),
      tools: [],
      scope: {provider: 'linear'},
    });

    const readResult = await session.call({
      toolId: 'get_issue',
      arguments: {id: 'ENG-875'},
    });
    const writeResult = await session.call({
      toolId: 'save_comment',
      arguments: {issueId: 'ENG-875', body: 'Looks good'},
    });
    await session.close?.();

    expect(readResult.structuredContent).toEqual({id: 'ENG-875'});
    expect(writeResult.structuredContent).toEqual({id: 'comment-1'});
    expect(callTool).toHaveBeenNthCalledWith(
      1,
      {toolId: 'get_issue', arguments: {id: 'ENG-875'}},
      1234,
    );
    expect(callTool).toHaveBeenNthCalledWith(
      2,
      {toolId: 'save_comment', arguments: {issueId: 'ENG-875', body: 'Looks good'}},
      1234,
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not open an MCP client when the Linear token is missing', async () => {
    const createClient = vi.fn();
    const provider = new LinearAgentToolsProvider({
      tokenStore: {
        getAccessToken: () =>
          Promise.reject(new LinearAccessTokenMissingError('linear-connection-1')),
      },
      createClient,
    });

    const result = provider.openSession({
      connection: linearConnection(),
      tools: [],
      scope: {provider: 'linear'},
    });

    await expect(result).rejects.toBeInstanceOf(LinearAccessTokenMissingError);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      'HTTP 500 outages',
      new StreamableHTTPError(500, 'Worker threw exception: secret response body'),
      {
        reason: 'provider-unavailable',
        message: 'Linear is temporarily unavailable. Please try again.',
        status: 500,
      },
    ],
    [
      'request timeouts',
      new McpError(ErrorCode.RequestTimeout, 'Request timed out', {timeout: 30_000}),
      {reason: 'timeout', message: 'Linear timed out. Please try again.'},
    ],
    [
      'HTTP request timeouts',
      new StreamableHTTPError(408, 'raw timeout response'),
      {reason: 'timeout', message: 'Linear timed out. Please try again.', status: 408},
    ],
    [
      'invalid credentials',
      new StreamableHTTPError(401, 'invalid_token: secret-token'),
      {
        reason: 'credentials-unavailable',
        message: 'Linear credentials are unavailable. Reconnect Linear and try again.',
        status: 401,
      },
    ],
    [
      'terminal provider rejections',
      new StreamableHTTPError(422, 'raw provider rejection'),
      {reason: 'provider-rejected', message: 'Linear rejected the request.', status: 422},
    ],
    [
      'network failures',
      new TypeError('fetch failed'),
      {
        reason: 'provider-unavailable',
        message: 'Linear is temporarily unavailable. Please try again.',
      },
    ],
    [
      'mid-response socket resets',
      new TypeError('terminated', {
        cause: Object.assign(new Error('other side closed'), {code: 'ECONNRESET'}),
      }),
      {
        reason: 'provider-unavailable',
        message: 'Linear is temporarily unavailable. Please try again.',
      },
    ],
  ])('maps call-time %s and still exposes close for cleanup', async (_name, remoteError, expected) => {
    const close = vi.fn().mockResolvedValue(undefined);
    const provider = new LinearAgentToolsProvider({
      tokenStore: {getAccessToken: async () => 'linear-token'},
      createClient: async () => ({
        callTool: () => Promise.reject(remoteError),
        close,
      }),
    });
    const session = await provider.openSession({
      connection: linearConnection(),
      tools: [],
      scope: {provider: 'linear'},
    });

    const result = session.call({toolId: 'get_issue', arguments: {id: 'ENG-875'}});
    await session.close?.();

    await expect(result).rejects.toMatchObject(expected);
    await expect(result).rejects.toBeInstanceOf(LinearIntegrationProviderError);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'HTTP 500 outages',
      new StreamableHTTPError(500, 'Worker threw exception: secret response body'),
      {reason: 'provider-unavailable', status: 500},
    ],
    [
      'request timeouts',
      new McpError(ErrorCode.RequestTimeout, 'Request timed out'),
      {reason: 'timeout'},
    ],
    [
      'cause-coded network timeouts',
      new Error('connect failed', {cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}}),
      {reason: 'timeout'},
    ],
    [
      'invalid credentials',
      new StreamableHTTPError(401, 'invalid_token: secret-token'),
      {reason: 'credentials-unavailable', status: 401},
    ],
  ])('maps connect-time %s', async (_name, remoteError, expected) => {
    const provider = new LinearAgentToolsProvider({
      tokenStore: {getAccessToken: async () => 'linear-token'},
      createClient: () => Promise.reject(remoteError),
    });

    const result = provider.openSession({
      connection: linearConnection(),
      tools: [],
      scope: {provider: 'linear'},
    });

    await expect(result).rejects.toMatchObject(expected);
    await expect(result).rejects.toBeInstanceOf(LinearIntegrationProviderError);
  });

  it('does not hide unknown SDK failures', async () => {
    const sdkError = new Error('unexpected SDK invariant');
    const provider = new LinearAgentToolsProvider({
      tokenStore: {getAccessToken: async () => 'linear-token'},
      createClient: () => Promise.reject(sdkError),
    });

    const result = provider.openSession({
      connection: linearConnection(),
      tools: [],
      scope: {provider: 'linear'},
    });

    await expect(result).rejects.toBe(sdkError);
  });
});

function handleMcpRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.method !== 'POST') {
    response.writeHead(405).end();
    return;
  }

  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    const message = JSON.parse(body) as {
      id?: string | number;
      method?: string;
      params?: {name?: string};
    };

    if (message.method === 'notifications/initialized') {
      response.writeHead(202).end();
      return;
    }

    if (message.method === 'initialize') {
      writeJson(response, {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {tools: {}},
          serverInfo: {name: 'mock-linear-mcp', version: '0.0.0'},
        },
      });
      return;
    }

    if (message.method === 'tools/call') {
      writeJson(response, {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{type: 'text', text: 'ok'}],
          structuredContent: {tool: message.params?.name},
        },
      });
      return;
    }

    writeJson(response, {
      jsonrpc: '2.0',
      id: message.id,
      error: {code: -32601, message: 'Method not found'},
    });
  });
}

function writeJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, {'content-type': 'application/json'});
  response.end(JSON.stringify(body));
}
