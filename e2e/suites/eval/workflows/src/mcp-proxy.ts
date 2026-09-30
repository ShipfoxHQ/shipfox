import {randomUUID} from 'node:crypto';
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'node:http';
import {closeServer, listenOnEndpoint} from '@shipfox/e2e-core';
import {
  type AgentAccessEndpoints,
  type AgentAccessTokens,
  authorizeAgentAccess,
  refreshAgentAccessTokens,
  registerAgentAccessClient,
} from './agent-access-oauth.js';
import {buildCallRecords, type McpCallRecord} from './mcp-calls.js';

const DEFAULT_CLIENT_NAME = 'Shipfox eval agent';
// OAuth accepts loopback redirects, and nothing listens here: the flow never follows the redirect.
const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:43210/oauth/callback';
// The access token lives 15 minutes. Renewing a minute early keeps a slow tool call from
// straddling the expiry.
const DEFAULT_REFRESH_MARGIN_MS = 60_000;
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
] as const;
// Node decodes the upstream body, so the length and encoding of the original no longer apply.
const DROPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'transfer-encoding',
]);

export interface McpProxyOptions extends AgentAccessEndpoints {
  /** Sent as `Origin`, which the API checks against its allowed origins. */
  origin: string;
  clientName?: string;
  redirectUri?: string;
  refreshMarginMs?: number;
  onCall?: (call: McpCallRecord) => void;
  now?: () => number;
  fetch?: typeof fetch;
}

export interface McpProxySession {
  id: string;
  /** The MCP endpoint to hand to the agent. */
  url: string;
  calls(): McpCallRecord[];
  close(): void;
}

export interface McpProxy {
  /** Authorizes the workspace for the signed-in user and returns a session bound to that grant. */
  openSession(params: {sessionToken: string; workspaceId: string}): Promise<McpProxySession>;
  /** Serves an existing grant, for callers that authorize outside the proxy. */
  attachSession(params: {clientId: string; tokens: AgentAccessTokens}): McpProxySession;
  close(): Promise<void>;
}

interface SessionState {
  session: McpProxySession;
  calls: McpCallRecord[];
  accessToken(options?: {forceRefresh?: boolean}): Promise<string>;
}

/**
 * Starts a local HTTP proxy to the stack's `/mcp`. Agents connect without credentials, and
 * the proxy adds a bearer token, renews it before it expires, and records every MCP call.
 * It registers one OAuth client for its lifetime, because registration is rate limited per IP.
 */
export async function startMcpProxy(options: McpProxyOptions): Promise<McpProxy> {
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const marginMs = options.refreshMarginMs ?? DEFAULT_REFRESH_MARGIN_MS;
  const redirectUri = options.redirectUri ?? DEFAULT_REDIRECT_URI;
  const sessions = new Map<string, SessionState>();
  let clientId: Promise<string> | undefined;
  let proxyOrigin = '';

  const oauth = {endpoints: options, fetch: http, now};

  function registeredClient(): Promise<string> {
    if (clientId) return clientId;
    const attempt = registerAgentAccessClient({
      ...oauth,
      clientName: options.clientName ?? DEFAULT_CLIENT_NAME,
      redirectUri,
    });
    clientId = attempt;
    // A failed registration is retried by the next case instead of failing every later one.
    attempt.catch(() => {
      if (clientId === attempt) clientId = undefined;
    });
    return attempt;
  }

  function attachSession(params: {clientId: string; tokens: AgentAccessTokens}): McpProxySession {
    const id = randomUUID();
    const calls: McpCallRecord[] = [];
    let tokens = params.tokens;
    let refreshing: Promise<void> | undefined;

    // One refresh at a time: a rotated refresh token is single-use, so parallel refreshes would
    // burn it.
    function refresh(): Promise<void> {
      refreshing ??= (async () => {
        if (tokens.refreshToken === undefined) {
          throw new Error('The agent-access grant has no refresh token');
        }
        const renewed = await refreshAgentAccessTokens({
          ...oauth,
          clientId: params.clientId,
          refreshToken: tokens.refreshToken,
        });
        tokens = {
          accessToken: renewed.accessToken,
          refreshToken: renewed.refreshToken ?? tokens.refreshToken,
          expiresAt: renewed.expiresAt,
        };
      })().finally(() => {
        refreshing = undefined;
      });
      return refreshing;
    }

    const state: SessionState = {
      calls,
      session: {
        id,
        url: `${proxyOrigin}/${id}/mcp`,
        calls: () => [...calls],
        close: () => {
          sessions.delete(id);
        },
      },
      async accessToken({forceRefresh = false} = {}) {
        if (forceRefresh || now() >= tokens.expiresAt - marginMs) await refresh();
        return tokens.accessToken;
      },
    };
    sessions.set(id, state);
    return state.session;
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(502, {'content-type': 'text/plain'});
      response.end(`MCP proxy error: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const state = sessionFor(request);
    if (!state) {
      response.writeHead(404, {'content-type': 'text/plain'}).end('Unknown MCP proxy session');
      return;
    }
    const body = await readBody(request);
    const startedAt = now();
    const upstream = await forward({request, body, state});

    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, name) => {
      if (!DROPPED_RESPONSE_HEADERS.has(name)) headers[name] = value;
    });
    response.writeHead(upstream.status, headers);

    // The agent gets each chunk as it arrives, so streamed results are not held back.
    const chunks: string[] = [];
    const decoder = new TextDecoder();
    if (upstream.body) {
      for await (const chunk of upstream.body) {
        chunks.push(decoder.decode(chunk, {stream: true}));
        response.write(chunk);
      }
    }
    response.end();

    for (const call of buildCallRecords({
      sessionId: state.session.id,
      requestBody: body.toString('utf8'),
      responseBody: chunks.join(''),
      responseContentType: upstream.headers.get('content-type'),
      httpStatus: upstream.status,
      startedAt,
      finishedAt: now(),
    })) {
      state.calls.push(call);
      options.onCall?.(call);
    }
  }

  async function forward(params: {
    request: IncomingMessage;
    body: Buffer;
    state: SessionState;
  }): Promise<Response> {
    const send = async (accessToken: string) =>
      await http(`${options.apiOrigin}/mcp`, {
        method: params.request.method ?? 'POST',
        headers: upstreamHeaders({request: params.request, accessToken, origin: options.origin}),
        ...(params.body.length === 0 ? {} : {body: new Uint8Array(params.body)}),
      });

    const first = await send(await params.state.accessToken());
    if (first.status !== 401) return first;
    // The API can revoke or expire a token ahead of our clock, so a rejection earns one renewal.
    await first.body?.cancel();
    return await send(await params.state.accessToken({forceRefresh: true}));
  }

  function sessionFor(request: IncomingMessage): SessionState | undefined {
    const [, id, endpoint] = new URL(request.url ?? '/', 'http://proxy').pathname.split('/');
    return endpoint === 'mcp' && id !== undefined ? sessions.get(id) : undefined;
  }

  const bound = await listenOnEndpoint(server, new URL('http://127.0.0.1:0'));
  proxyOrigin = bound.origin;

  return {
    async openSession({sessionToken, workspaceId}) {
      const client = await registeredClient();
      const tokens = await authorizeAgentAccess({
        ...oauth,
        clientId: client,
        redirectUri,
        sessionToken,
        workspaceId,
      });
      return attachSession({clientId: client, tokens});
    },
    attachSession,
    async close() {
      sessions.clear();
      await stopServer(server);
    },
  };
}

function upstreamHeaders(params: {
  request: IncomingMessage;
  accessToken: string;
  origin: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${params.accessToken}`,
    origin: params.origin,
  };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = params.request.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function stopServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await closeServer(server);
}
