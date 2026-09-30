import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {type McpProxy, startMcpProxy} from './mcp-proxy.js';

const WORKSPACE_ID = '0c0f3f5c-7f5e-4e3e-9d3a-6f6a0a6f1b11';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const MINUTE_MS = 60_000;

interface FakeStack {
  origin: string;
  refreshes: number;
  registrations: number;
  tokenRequests: URLSearchParams[];
  mcpBearers: string[];
  /** Makes the API reject the next presented access token, as when it is revoked early. */
  rejectNextToken(): void;
  close(): Promise<void>;
}

async function readText(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

function sendEvent(response: ServerResponse, message: unknown): void {
  response
    .writeHead(200, {'content-type': 'text/event-stream'})
    .end(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

/** A stand-in for the API's OAuth and `/mcp` endpoints, with tokens that expire on `clock`. */
async function startFakeStack(clock: {now: number}): Promise<FakeStack> {
  const stack: FakeStack = {
    origin: '',
    refreshes: 0,
    registrations: 0,
    tokenRequests: [],
    mcpBearers: [],
    rejectNextToken: () => {
      rejectNext = true;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  const tokenExpiry = new Map<string, number>();
  let generation = 0;
  let rejectNext = false;
  let state = '';

  function issueTokens() {
    generation += 1;
    tokenExpiry.set(`access-${generation}`, clock.now + ACCESS_TOKEN_TTL_SECONDS * 1000);
    return {
      access_token: `access-${generation}`,
      token_type: 'Bearer',
      refresh_token: `refresh-${generation}`,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  function handleMcp(message: {id?: number; method: string}, response: ServerResponse): void {
    if (message.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    if (message.method === 'initialize') {
      sendEvent(response, {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {tools: {}},
          serverInfo: {name: 'fake', version: '0.0.0'},
        },
      });
      return;
    }
    if (message.method === 'tools/call') {
      sendEvent(response, {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          content: [{type: 'text', text: '{}'}],
          structuredContent: {ok: true, result: {}},
        },
      });
      return;
    }
    sendEvent(response, {jsonrpc: '2.0', id: message.id, result: {tools: []}});
  }

  function handleOAuth(path: string, body: string, response: ServerResponse): boolean {
    if (path === '/oauth/register') {
      stack.registrations += 1;
      sendJson(response, 201, {
        client_id: 'client-1',
        client_name: 'Shipfox eval agent',
        redirect_uris: ['http://127.0.0.1:43210/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    } else if (path === '/oauth/consents/request-1') {
      sendJson(response, 200, {
        request_id: '11111111-1111-4111-8111-111111111111',
        client_name: 'Shipfox eval agent',
        expires_at: new Date(clock.now + MINUTE_MS).toISOString(),
        redirect_uri_hostname: '127.0.0.1',
        is_loopback_redirect: true,
        workspaces: [{workspace_id: WORKSPACE_ID, role: 'owner'}],
        client_identity_kind: 'self-registered',
        client_identity_origin: null,
      });
    } else if (path === '/oauth/consents/request-1/approve') {
      sendJson(response, 200, {
        redirect_url: `http://127.0.0.1:43210/oauth/callback?code=code-1&state=${state}`,
      });
    } else if (path === '/oauth/token') {
      const form = new URLSearchParams(body);
      stack.tokenRequests.push(form);
      if (form.get('grant_type') === 'refresh_token') stack.refreshes += 1;
      sendJson(response, 200, issueTokens());
    } else {
      return false;
    }
    return true;
  }

  function handleMcpRequest(request: IncomingMessage, body: string, response: ServerResponse) {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const bearer = request.headers.authorization?.replace('Bearer ', '') ?? '';
    stack.mcpBearers.push(bearer);
    const expiresAt = tokenExpiry.get(bearer);
    if (rejectNext || expiresAt === undefined || clock.now >= expiresAt) {
      rejectNext = false;
      sendJson(response, 401, {code: 'unauthorized'});
      return;
    }
    handleMcp(JSON.parse(body) as {id?: number; method: string}, response);
  }

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://fake');
      const body = await readText(request);

      if (url.pathname === '/oauth/authorize') {
        state = url.searchParams.get('state') ?? '';
        response.writeHead(302, {location: '/consent?request_id=request-1'}).end();
      } else if (url.pathname === '/mcp') {
        handleMcpRequest(request, body, response);
      } else if (!handleOAuth(url.pathname, body, response)) {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  stack.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return stack;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function setup(): Promise<{
  clock: {now: number};
  stack: FakeStack;
  proxy: McpProxy;
  connect: (url: string) => Promise<Client>;
}> {
  const clock = {now: Date.parse('2026-09-29T12:00:00Z')};
  const stack = await startFakeStack(clock);
  const proxy = await startMcpProxy({
    apiOrigin: stack.origin,
    publicOrigin: stack.origin,
    origin: 'http://localhost:16100',
    now: () => clock.now,
  });
  cleanups.push(stack.close, () => proxy.close());
  const connect = async (url: string) => {
    const client = new Client({name: 'eval-agent', version: '0.0.0'});
    await client.connect(new StreamableHTTPClientTransport(new URL(url)) as never);
    cleanups.push(() => client.close());
    return client;
  };
  return {clock, stack, proxy, connect};
}

describe('agent-access MCP proxy', () => {
  it('holds a proxied session open past a token refresh', async () => {
    const {clock, stack, proxy, connect} = await setup();
    const session = await proxy.openSession({
      sessionToken: 'user-session',
      workspaceId: WORKSPACE_ID,
    });
    const client = await connect(session.url);
    await client.callTool({name: 'list_projects', arguments: {}});

    clock.now += (ACCESS_TOKEN_TTL_SECONDS - 30) * 1000;
    const result = await client.callTool({name: 'list_projects', arguments: {}});

    expect(result.isError).toBeFalsy();
    expect(stack.refreshes).toBe(1);
    expect(stack.mcpBearers.at(0)).toBe('access-1');
    expect(stack.mcpBearers.at(-1)).toBe('access-2');
  });

  it('refreshes once when parallel calls find the token expiring', async () => {
    const {clock, stack, proxy, connect} = await setup();
    const session = await proxy.openSession({
      sessionToken: 'user-session',
      workspaceId: WORKSPACE_ID,
    });
    const client = await connect(session.url);
    clock.now += ACCESS_TOKEN_TTL_SECONDS * 1000;

    await Promise.all([
      client.callTool({name: 'list_projects', arguments: {}}),
      client.callTool({name: 'list_workflow_runs', arguments: {}}),
    ]);

    expect(stack.refreshes).toBe(1);
  });

  it('presents the rotated refresh token on the next refresh', async () => {
    const {clock, stack, proxy, connect} = await setup();
    const session = await proxy.openSession({
      sessionToken: 'user-session',
      workspaceId: WORKSPACE_ID,
    });
    const client = await connect(session.url);

    clock.now += ACCESS_TOKEN_TTL_SECONDS * 1000;
    await client.callTool({name: 'list_projects', arguments: {}});
    clock.now += ACCESS_TOKEN_TTL_SECONDS * 1000;
    await client.callTool({name: 'list_projects', arguments: {}});

    const refreshTokens = stack.tokenRequests
      .filter((form) => form.get('grant_type') === 'refresh_token')
      .map((form) => form.get('refresh_token'));
    expect(refreshTokens).toEqual(['refresh-1', 'refresh-2']);
  });

  it('renews the token and retries when the API rejects it early', async () => {
    const {stack, proxy, connect} = await setup();
    const session = await proxy.openSession({
      sessionToken: 'user-session',
      workspaceId: WORKSPACE_ID,
    });
    const client = await connect(session.url);
    stack.rejectNextToken();

    const result = await client.callTool({name: 'list_projects', arguments: {}});

    expect(result.isError).toBeFalsy();
    expect(stack.refreshes).toBe(1);
  });

  it('registers one OAuth client and reuses it for every workspace', async () => {
    const {stack, proxy} = await setup();

    await proxy.openSession({sessionToken: 'user-session', workspaceId: WORKSPACE_ID});
    await proxy.openSession({sessionToken: 'user-session', workspaceId: WORKSPACE_ID});

    const codeExchanges = stack.tokenRequests.filter(
      (form) => form.get('grant_type') === 'authorization_code',
    );
    expect(stack.registrations).toBe(1);
    expect(codeExchanges).toHaveLength(2);
    expect(codeExchanges.map((form) => form.get('client_id'))).toEqual(['client-1', 'client-1']);
  });

  it('logs each call with its tool, arguments, result status, and time', async () => {
    const {proxy, connect} = await setup();
    const session = await proxy.openSession({
      sessionToken: 'user-session',
      workspaceId: WORKSPACE_ID,
    });
    const client = await connect(session.url);

    await client.callTool({name: 'list_projects', arguments: {limit: 5}});

    const call = session.calls().find((entry) => entry.method === 'tools/call');
    expect(call).toMatchObject({
      tool: 'list_projects',
      arguments: {limit: 5},
      status: 'ok',
      httpStatus: 200,
    });
    expect(call?.durationMs).toBeGreaterThanOrEqual(0);
    expect(session.calls().map((entry) => entry.method)).toContain('initialize');
  });

  it('answers a stopped session with 404', async () => {
    const {proxy} = await setup();
    const session = await proxy.openSession({
      sessionToken: 'user-session',
      workspaceId: WORKSPACE_ID,
    });
    session.close();

    const response = await fetch(session.url, {method: 'POST', body: '{}'});

    expect(response.status).toBe(404);
  });
});
