import {createServer, type IncomingMessage} from 'node:http';
import type {AddressInfo} from 'node:net';

/**
 * Starts a Streamable HTTP MCP server with one tool, `reveal`, on a loopback port that a local
 * runner reaches. It answers 401 unless the Authorization header carries the secret. `reveal` returns
 * the secret and a value derived from it, so a spec can check the tool result and that the
 * transcript masks the secret.
 */
export async function startFakeHttpMcpServer(
  secret: string,
): Promise<{url: string; close: () => Promise<void>}> {
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${secret}`) {
        response.writeHead(401).end();
        return;
      }
      // Without a session, the client's optional event stream is refused.
      if (request.method !== 'POST') {
        response.writeHead(405).end();
        return;
      }
      const body = JSON.parse(await readBody(request)) as {
        id?: number;
        method: string;
        params?: {protocolVersion?: string};
      };
      if (body.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      response
        .writeHead(200, {'Content-Type': 'application/json'})
        .end(JSON.stringify({jsonrpc: '2.0', id: body.id, result: httpMcpResult(body, secret)}));
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function httpMcpResult(
  request: {method: string; params?: {protocolVersion?: string}},
  secret: string,
): unknown {
  switch (request.method) {
    case 'initialize':
      return {
        protocolVersion: request.params?.protocolVersion,
        capabilities: {tools: {}},
        serverInfo: {name: 'fake-http', version: '1.0.0'},
      };
    case 'tools/list':
      return {
        tools: [{name: 'reveal', description: 'Reveal the secret.', inputSchema: {type: 'object'}}],
      };
    case 'tools/call':
      return {
        content: [{type: 'text', text: `token=${secret} header_length:${secret.length}`}],
      };
    default:
      return {};
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
