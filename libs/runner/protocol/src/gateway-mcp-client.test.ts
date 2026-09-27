import {once} from 'node:events';
import {createServer, type Server as HttpServer} from 'node:http';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import {CallToolRequestSchema, ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createGatewayMcpClient} from '#gateway-mcp-client.js';

describe('createGatewayMcpClient', () => {
  let gateway: HttpServer | undefined;

  afterEach(async () => {
    gateway?.closeAllConnections();
    await new Promise((resolve) => gateway?.close(resolve) ?? resolve(undefined));
    gateway = undefined;
  });

  it('lists and calls gateway tools', async () => {
    const url = await startFakeGateway();
    const client = createGatewayMcpClient({url, fetch, name: 'test'});

    const tools = await client.listTools();
    const result = await client.callTool({name: 'github_main__issue_read', arguments: {id: 1}});
    await client.close();

    expect(tools.tools.map((tool) => tool.name)).toEqual(['github_main__issue_read']);
    expect(result.structuredContent).toEqual({name: 'github_main__issue_read', arguments: {id: 1}});
  });

  it('replaces the connection after a failed request', async () => {
    const url = await startFakeGateway();
    let failNextCall = true;
    let initializeRequests = 0;
    const client = createGatewayMcpClient({
      url,
      name: 'test',
      fetch: (input, init) => {
        const body =
          typeof init?.body === 'string' ? (JSON.parse(init.body) as {method?: string}) : undefined;
        if (body?.method === 'initialize') initializeRequests += 1;
        if (failNextCall && body?.method === 'tools/call') {
          failNextCall = false;
          return Promise.resolve(new Response('temporarily unavailable', {status: 503}));
        }
        return fetch(input, init);
      },
    });

    await expect(client.callTool({name: 'github_main__issue_read'})).rejects.toThrow();
    const result = await client.callTool({name: 'github_main__issue_read'});
    await client.close();

    expect(result.isError).not.toBe(true);
    expect(initializeRequests).toBe(2);
  });

  it('rejects requests after close', async () => {
    const url = await startFakeGateway();
    const client = createGatewayMcpClient({url, fetch, name: 'test'});

    await Promise.all([client.close(), client.close()]);

    await expect(client.listTools()).rejects.toThrow('Gateway MCP client is closed.');
  });

  async function startFakeGateway(): Promise<URL> {
    gateway = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString('utf8');
      const server = new Server(
        {name: 'fake-gateway', version: '0.0.0'},
        {capabilities: {tools: {}}},
      );
      server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: [{name: 'github_main__issue_read', inputSchema: {type: 'object'}}],
      }));
      server.setRequestHandler(CallToolRequestSchema, (toolRequest) => ({
        content: [{type: 'text', text: 'called'}],
        structuredContent: {
          name: toolRequest.params.name,
          arguments: toolRequest.params.arguments,
        },
      }));
      const transport = new StreamableHTTPServerTransport();
      await server.connect(transport as unknown as Transport);
      response.on('close', () => {
        void transport.close();
        void server.close();
      });
      await transport.handleRequest(
        request,
        response,
        text === '' ? undefined : (JSON.parse(text) as unknown),
      );
    });
    gateway.listen(0, '127.0.0.1');
    await once(gateway, 'listening');
    const address = gateway.address();
    if (typeof address !== 'object' || address === null) throw new Error('No gateway address.');
    return new URL(`http://127.0.0.1:${address.port}/mcp`);
  }
});
