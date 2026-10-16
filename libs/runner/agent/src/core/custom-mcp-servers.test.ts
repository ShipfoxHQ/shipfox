import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type {Transport} from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  MaterializedAgentHttpMcpServerConfigDto,
  MaterializedAgentStdioMcpServerConfigDto,
} from '@shipfox/api-agent-dto';
import {localExecutionHost} from '@shipfox/runner-container';
import {
  type CustomMcpServers,
  CustomMcpServerUnavailableError,
  startCustomMcpServers,
} from '#core/custom-mcp-servers.js';

const FAKE_SERVER = fileURLToPath(new URL('./fixtures/fake-stdio-mcp-server.sh', import.meta.url));

const HTTP_TOKEN = 'http-s3cr3t';

function server(
  overrides: Partial<MaterializedAgentStdioMcpServerConfigDto> = {},
): MaterializedAgentStdioMcpServerConfigDto {
  return {name: 'fake', command: 'sh', args: [FAKE_SERVER], env: {}, ...overrides};
}

function httpServer(
  url: string,
  overrides: Partial<MaterializedAgentHttpMcpServerConfigDto> = {},
): MaterializedAgentHttpMcpServerConfigDto {
  return {name: 'docs', url, headers: {}, ...overrides};
}

interface FakeHttpMcpServer {
  readonly url: string;
  /** The method and session of every request the server received. */
  readonly requests: {method: string; sessionId: string | undefined}[];
  /** Answers every later POST with a 500 and this body. */
  failRequests(body: string): void;
  close(): Promise<void>;
}

function fakeMcpServer(): McpServer {
  const mcp = new McpServer({name: 'fake-http', version: '1.0.0'});
  mcp.registerTool('whoami', {description: 'Describe the caller.'}, () => ({
    content: [{type: 'text', text: `token-length:${HTTP_TOKEN.length}`}],
  }));
  mcp.registerTool('search', {description: 'Search the docs.'}, () => ({
    content: [{type: 'text', text: 'no results'}],
  }));
  return mcp;
}

/**
 * A Streamable HTTP MCP server with `whoami` and `search` tools. It answers 401 with the received
 * Authorization header unless that header carries `HTTP_TOKEN`. A stateful server keeps one
 * session; a stateless one serves each request on its own.
 */
async function startHttpMcpServer(options: {stateful?: boolean} = {}): Promise<FakeHttpMcpServer> {
  const requests: FakeHttpMcpServer['requests'] = [];
  let failureBody: string | undefined;
  // The SDK transport types do not satisfy exactOptionalPropertyTypes.
  const session = options.stateful
    ? (() => {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          enableJsonResponse: true,
        });
        return {transport, connected: fakeMcpServer().connect(transport as unknown as Transport)};
      })()
    : undefined;
  const http = createServer((request, response) => {
    const sessionId = request.headers['mcp-session-id'];
    requests.push({
      method: request.method ?? '',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    });
    const authorization = request.headers.authorization ?? '';
    if (authorization !== `Bearer ${HTTP_TOKEN}`) {
      response.writeHead(401).end(`rejected ${authorization}`);
      return;
    }
    if (failureBody !== undefined && request.method === 'POST') {
      response.writeHead(500).end(failureBody);
      return;
    }
    if (session !== undefined) {
      void session.connected.then(() => session.transport.handleRequest(request, response));
      return;
    }
    // Without a session ID generator, the transport is stateless.
    const transport = new StreamableHTTPServerTransport({enableJsonResponse: true});
    const mcp = fakeMcpServer();
    response.on('close', () => {
      void mcp.close();
    });
    void mcp
      .connect(transport as unknown as Transport)
      .then(() => transport.handleRequest(request, response));
  });
  return {
    ...(await listenOnLoopback(http)),
    requests,
    failRequests: (body) => (failureBody = body),
  };
}

/** Answers `initialize`, then never answers the `notifications/initialized` that follows. */
async function startStalledHttpMcpServer(): Promise<{url: string; close: () => Promise<void>}> {
  const http = createServer((request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        id?: number;
        method: string;
        params?: {protocolVersion?: string};
      };
      if (body.method !== 'initialize') return;
      response.writeHead(200, {'Content-Type': 'application/json'}).end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: body.params?.protocolVersion,
            capabilities: {tools: {}},
            serverInfo: {name: 'stalled', version: '1.0.0'},
          },
        }),
      );
    });
  });
  return await listenOnLoopback(http);
}

async function listenOnLoopback(http: Server): Promise<{url: string; close: () => Promise<void>}> {
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const {port} = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

function start(params: Partial<Parameters<typeof startCustomMcpServers>[0]> = {}) {
  return startCustomMcpServers({
    servers: [server()],
    host: localExecutionHost,
    cwd: process.cwd(),
    baseEnv: {PATH: process.env.PATH ?? ''},
    redactions: [],
    reservedToolNames: new Set(),
    ...params,
  });
}

describe('startCustomMcpServers', () => {
  let servers: CustomMcpServers | undefined;

  afterEach(async () => {
    await servers?.close();
    servers = undefined;
  });

  it('lists each server tool under the server name and calls it with the server env', async () => {
    servers = await start({
      servers: [server({env: {FAKE_SECRET: 'literal'}}), server({name: 'other'})],
      secretEnv: {other: {FAKE_SECRET: 'from-a-secret'}},
    });

    const literal = await servers.callTool({name: 'fake__secret_length', arguments: {}});
    const result = await servers.callTool({name: 'other__secret_length', arguments: {}});

    expect(servers.tools.map((tool) => tool.name)).toEqual([
      'fake__secret_length',
      'fake__crash',
      'other__secret_length',
      'other__crash',
    ]);
    expect(servers.requestedTools).toContainEqual({connectionSlug: 'fake', toolId: 'crash'});
    expect(literal.content).toEqual([{type: 'text', text: 'length:7'}]);
    expect(result.content).toEqual([{type: 'text', text: 'length:13'}]);
  });

  it('keeps only the included tools', async () => {
    servers = await start({servers: [server({include: ['secret_length']})]});

    expect(servers.tools.map((tool) => tool.name)).toEqual(['fake__secret_length']);
    expect(servers.has('fake__crash')).toBe(false);
  });

  it('fails when an included tool is not listed', async () => {
    const started = start({servers: [server({include: ['secret_length', 'drop_table']})]});

    await expect(started).rejects.toThrow(
      'MCP server "fake" does not list the included tools: drop_table.',
    );
  });

  it('fails with the redacted stderr of a server that exits before it answers', async () => {
    const started = start({
      servers: [server({env: {FAKE_STDERR: 'bad token hunter2', FAKE_EXIT_CODE: '1'}})],
      redactions: ['hunter2'],
    });

    await expect(started).rejects.toThrow(CustomMcpServerUnavailableError);
    await expect(started).rejects.toThrow(
      'MCP server "fake" did not start: exited with code 1. stderr: bad token ***',
    );
  });

  it('fails when the command does not exist', async () => {
    const started = start({servers: [server({command: 'shipfox-missing-mcp-server', args: []})]});

    await expect(started).rejects.toThrow('MCP server "fake" did not start');
  });

  it('fails a server that does not answer before the start timeout', async () => {
    const started = start({
      servers: [server({command: 'sleep', args: ['30']})],
      startTimeoutMs: 200,
    });

    await expect(started).rejects.toThrow(
      'MCP server "fake" did not start: it did not answer within 0.2 seconds.',
    );
  });

  it('fails a tool whose Claude name would pass 64 characters', async () => {
    const started = start({
      servers: [
        server({
          env: {
            FAKE_TOOLS:
              '{"name":"atlas-inspect-access-list-entries-for-project","inputSchema":{"type":"object"}}',
          },
        }),
      ],
    });

    await expect(started).rejects.toThrow(
      'as "mcp__shipfox__fake__atlas-inspect-access-list-entries-for-project" it must have at most 64',
    );
  });

  it('fails a tool name that an integration tool on the step already uses', async () => {
    const started = start({reservedToolNames: new Set(['fake__crash'])});

    await expect(started).rejects.toThrow('under a name that another tool on this step uses');
  });

  it('stops the servers that started when another one fails', async () => {
    const killed: string[] = [];
    const host = {
      ...localExecutionHost,
      spawn: (request: Parameters<typeof localExecutionHost.spawn>[0]) => {
        const child = localExecutionHost.spawn(request);
        return {
          ...child,
          killTree: async () => {
            killed.push(request.env.FAKE_NAME ?? '');
            await child.killTree();
          },
        };
      },
    };

    const started = start({
      host,
      servers: [
        server({env: {FAKE_NAME: 'ok'}}),
        server({name: 'broken', env: {FAKE_NAME: 'broken', FAKE_EXIT_CODE: '2'}}),
      ],
    });

    await expect(started).rejects.toThrow('MCP server "broken" did not start');
    expect(killed).toContain('ok');
  });

  it('returns an error result for calls after the server exits', async () => {
    servers = await start();

    const crash = await servers.callTool({name: 'fake__crash', arguments: {}});
    const after = await servers.callTool({name: 'fake__secret_length', arguments: {}});

    expect(crash).toEqual({
      isError: true,
      content: [{type: 'text', text: 'MCP server fake exited with code 3.'}],
    });
    expect(after.isError).toBe(true);
  });

  describe('url servers', () => {
    let http: Awaited<ReturnType<typeof startHttpMcpServer>>;

    beforeEach(async () => {
      http = await startHttpMcpServer();
    });

    afterEach(async () => {
      await http.close();
    });

    it('lists the tools of a url server and calls them with the secret header', async () => {
      servers = await start({
        servers: [httpServer(http.url, {headers: {'X-Client': 'shipfox'}}), server()],
        secretHeaders: {docs: {Authorization: `Bearer ${HTTP_TOKEN}`}},
      });

      const result = await servers.callTool({name: 'docs__whoami', arguments: {}});

      expect(servers.tools.map((tool) => tool.name)).toEqual([
        'docs__whoami',
        'docs__search',
        'fake__secret_length',
        'fake__crash',
      ]);
      expect(servers.requestedTools).toContainEqual({connectionSlug: 'docs', toolId: 'search'});
      expect(result.content).toEqual([{type: 'text', text: `token-length:${HTTP_TOKEN.length}`}]);
    });

    it('keeps only the included tools of a url server', async () => {
      servers = await start({
        servers: [httpServer(http.url, {include: ['search']})],
        secretHeaders: {docs: {Authorization: `Bearer ${HTTP_TOKEN}`}},
      });

      expect(servers.tools.map((tool) => tool.name)).toEqual(['docs__search']);
    });

    it('fails when an included tool is not listed by a url server', async () => {
      const started = start({
        servers: [httpServer(http.url, {include: ['drop_table']})],
        secretHeaders: {docs: {Authorization: `Bearer ${HTTP_TOKEN}`}},
      });

      await expect(started).rejects.toThrow(
        'MCP server "docs" does not list the included tools: drop_table.',
      );
    });

    it('fails with a redacted error when the url server rejects the request', async () => {
      const started = start({
        servers: [httpServer(http.url, {headers: {Authorization: 'Bearer wrong-token'}})],
        redactions: ['wrong-token'],
      });

      await expect(started).rejects.toThrow(CustomMcpServerUnavailableError);
      await expect(started).rejects.toThrow(`MCP server "docs" at ${http.url} did not answer`);
      await expect(started).rejects.toThrow('rejected Bearer ***');
    });

    it('masks a secret that crosses the cut of a long error message', async () => {
      const secret = `S${'q'.repeat(8 * 1024)}`;
      const started = start({
        servers: [httpServer(http.url, {headers: {Authorization: `Bearer ${secret}`}})],
        redactions: [secret],
      });

      await expect(started).rejects.toThrow('rejected Bearer ***');
      await expect(started).rejects.not.toThrow('Sqqq');
    });

    it('returns a masked error result when a url server fails during a call', async () => {
      servers = await start({
        servers: [httpServer(http.url)],
        secretHeaders: {docs: {Authorization: `Bearer ${HTTP_TOKEN}`}},
        redactions: [HTTP_TOKEN],
      });
      http.failRequests(`upstream broke for ${HTTP_TOKEN} ${'x'.repeat(10 * 1024)}`);

      const result = await servers.callTool({name: 'docs__whoami', arguments: {}});

      expect(result.isError).toBe(true);
      const text = JSON.stringify(result.content);
      expect(text).toContain('MCP server docs did not answer');
      expect(text).toContain('upstream broke for ***');
      expect(text).not.toContain(HTTP_TOKEN);
      expect(text.length).toBeLessThan(5 * 1024);
    });

    it('ends the session of a url server when it stops', async () => {
      const stateful = await startHttpMcpServer({stateful: true});
      try {
        const started = await start({
          servers: [httpServer(stateful.url)],
          secretHeaders: {docs: {Authorization: `Bearer ${HTTP_TOKEN}`}},
        });
        const sessionId = stateful.requests.find((request) => request.sessionId)?.sessionId;

        await started.close();

        expect(sessionId).toBeDefined();
        expect(stateful.requests).toContainEqual({method: 'DELETE', sessionId});
      } finally {
        await stateful.close();
      }
    });

    it('fails when nothing listens at the url', async () => {
      const url = http.url;
      await http.close();

      const started = start({servers: [httpServer(url)]});

      await expect(started).rejects.toThrow(`MCP server "docs" at ${url} did not answer`);
    });
  });

  describe('a url server that stalls during start', () => {
    let stalled: Awaited<ReturnType<typeof startStalledHttpMcpServer>>;

    beforeEach(async () => {
      stalled = await startStalledHttpMcpServer();
    });

    afterEach(async () => {
      await stalled.close();
    });

    it('fails at the start timeout', async () => {
      const started = start({servers: [httpServer(stalled.url)], startTimeoutMs: 300});

      await expect(started).rejects.toThrow(
        `MCP server "docs" at ${stalled.url} did not answer: it did not answer within 0.3 seconds.`,
      );
    });

    it('stops waiting when the caller aborts', async () => {
      const controller = new AbortController();
      const started = start({servers: [httpServer(stalled.url)], signal: controller.signal});
      setTimeout(() => controller.abort(new Error('step canceled')), 200);

      await expect(started).rejects.toThrow('did not answer: step canceled.');
    });
  });
});
