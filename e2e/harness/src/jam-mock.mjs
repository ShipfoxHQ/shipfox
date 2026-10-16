import {once} from 'node:events';
import {createServer} from 'node:http';
import fixtures from './jam-mock-fixtures.json' with {type: 'json'};

const JAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const JAM_URL_RE = /^https:\/\/jam\.dev\/c\/([0-9a-f-]{36})(?:[/?#].*)?$/iu;
const MAX_FRAMES = 30;
const DEFAULT_FRAMES = 5;
const FRAME_SPAN_MS = 9000;
const SCOPES = 'cli:read mcp:read';
const CLI_ONLY_SCOPES = 'cli:read cli:write';
const ISSUED_AT = 1_792_131_374;
const EXPIRES_AT = 1_823_667_374;

/**
 * The E2E deployment's Jam double. It serves Jam's token introspection and its MCP at `/mcp`,
 * answers the ten read tools and `listMembers` with the results Jam returned for the two
 * sandbox Jams (a video and a screenshot), and records every call by token.
 *
 * A token that contains `revoked` is rejected with HTTP 401 at initialize, as Jam rejects a
 * revoked one, and its introspection says `active: false`. A token that contains `cli-only`
 * passes introspection without the `mcp:read` scope. A token that contains `stale` holds each
 * tool call until the control route releases it.
 */
export async function startJamMock(endpoint) {
  const calls = [];
  const mcpRequestCounts = new Map();
  const revoked = new Set();
  const pending = new Map();
  const server = createServer((request, response) => {
    void handleRequest({
      calls,
      mcpRequestCounts,
      revoked,
      pending,
      endpoint,
      request,
      response,
    }).catch((error) => {
      process.stderr.write(`Jam mock request failed: ${String(error)}\n`);
      if (!response.headersSent) sendJson(response, 500, {error: 'E2E Jam mock failure'});
      else response.end();
    });
  });

  server.listen({host: endpoint.hostname, port: Number(endpoint.port)});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected Jam mock TCP address.');
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);

  return {
    endpoint: boundEndpoint,
    calls,
    stop: async () => {
      for (const waiters of pending.values()) {
        for (const waiter of waiters) waiter({status: 401});
      }
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    },
  };
}

async function handleRequest({
  calls,
  mcpRequestCounts,
  revoked,
  pending,
  endpoint,
  request,
  response,
}) {
  const url = new URL(request.url ?? '/', endpoint);
  if (url.pathname === '/__e2e/calls' && request.method === 'GET') {
    const token = url.searchParams.get('token');
    sendJson(response, 200, token ? calls.filter((call) => call.token === token) : calls);
    return;
  }
  if (url.pathname === '/__e2e/mcp-request-count' && request.method === 'GET') {
    const token = url.searchParams.get('token');
    sendJson(response, 200, {count: token ? (mcpRequestCounts.get(token) ?? 0) : 0});
    return;
  }
  if (url.pathname === '/__e2e/control' && request.method === 'POST') {
    await handleControl({revoked, pending, request, response});
    return;
  }
  if (url.pathname === '/oauth/introspect' && request.method === 'POST') {
    await handleIntrospect({revoked, request, response});
    return;
  }
  if (url.pathname === '/mcp') {
    await handleMcp({calls, mcpRequestCounts, revoked, pending, request, response});
    return;
  }
  response.writeHead(404).end();
}

// `revoke_token` makes the token fail like a revoked one from now on. `release_token` answers the
// calls held for a stale token: with HTTP 401 once the token is revoked, otherwise with the result.
async function handleControl({revoked, pending, request, response}) {
  const body = await readJsonBody(request);
  if (typeof body?.revoke_token === 'string') revoked.add(body.revoke_token);
  if (typeof body?.release_token === 'string') {
    const waiters = pending.get(body.release_token) ?? [];
    pending.delete(body.release_token);
    for (const waiter of waiters) {
      waiter(isRevoked({token: body.release_token, revoked}) ? {status: 401} : {});
    }
  }
  sendJson(response, 200, {ok: true});
}

async function handleIntrospect({revoked, request, response}) {
  const token = new URLSearchParams(await consume(request)).get('token') ?? '';
  if (!token.startsWith('jam_pat_') || isRevoked({token, revoked})) {
    sendJson(response, 200, {active: false});
    return;
  }
  const [admin] = fixtures.members;
  sendJson(response, 200, {
    active: true,
    tokenType: 'pat',
    user_id: admin.id,
    team_id: fixtures.team_id,
    scope: token.includes('cli-only') ? CLI_ONLY_SCOPES : SCOPES,
    token_type: 'Bearer',
    exp: EXPIRES_AT,
    iat: ISSUED_AT,
    sub: admin.id,
  });
}

async function handleMcp({calls, mcpRequestCounts, revoked, pending, request, response}) {
  const token = bearer(request);
  mcpRequestCounts.set(token, (mcpRequestCounts.get(token) ?? 0) + 1);
  if (request.method === 'DELETE') {
    response.writeHead(200).end();
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405).end();
    return;
  }
  const body = await readJsonBody(request);
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, {
      jsonrpc: '2.0',
      id: null,
      error: {code: -32600, message: 'Invalid Request'},
    });
    return;
  }
  // Jam checks the token on every request, so a revocation also ends a session that is open.
  if (isRevoked({token, revoked})) {
    sendInvalidToken(response);
    return;
  }
  if (body.method === 'initialize') {
    sendMcpResult(response, body.id, {
      protocolVersion: body.params?.protocolVersion ?? '2025-06-18',
      capabilities: {tools: {}},
      serverInfo: {name: 'jam-e2e-mock', version: '0.0.0'},
    });
    return;
  }
  if (body.method === 'tools/list') {
    sendMcpResult(response, body.id, {
      tools: Object.keys(TOOLS).map((name) => ({
        name,
        description: `E2E ${name}`,
        inputSchema: {type: 'object'},
      })),
    });
    return;
  }
  if (body.method !== 'tools/call') {
    // A notification, such as `notifications/initialized` or `notifications/cancelled`, has no id
    // and gets no JSON-RPC answer. A request the fake doesn't serve is a method that doesn't exist.
    if (body.id === undefined) {
      response.writeHead(202).end();
      return;
    }
    sendMcpError(response, body.id, {code: -32601, message: `Method not found: ${body.method}`});
    return;
  }

  calls.push({
    kind: 'mcp',
    token,
    tool_name: body.params?.name,
    arguments: body.params?.arguments ?? {},
  });
  if (token.includes('stale')) {
    const released = await new Promise((resolve) => {
      pending.set(token, [...(pending.get(token) ?? []), resolve]);
    });
    if (released.status === 401) {
      sendInvalidToken(response);
      return;
    }
  }
  sendMcpResult(response, body.id, toolResult(body.params));
}

function isRevoked({token, revoked}) {
  return token.includes('revoked') || revoked.has(token);
}

function toolResult(params) {
  const tool = TOOLS[params?.name];
  if (tool === undefined) return toolError(`MCP error -32602: Unknown tool: ${params?.name}`);
  return tool(params.arguments ?? {});
}

// A tool that reads one Jam resolves its `jamId` first, as Jam does.
function forJam(read) {
  return (args) => {
    const resolved = resolveJam(args.jamId);
    if (resolved.error !== undefined) return toolError(resolved.error);
    return read({args, jam: resolved.jam});
  };
}

const TOOLS = {
  getDetails: forJam(({jam}) => ({
    content: [
      {type: 'text', text: JSON.stringify(jam.details)},
      {type: 'text', text: jam.guide},
    ],
  })),
  getConsoleLogs: forJam(({args, jam}) =>
    eventsOf({
      jam,
      field: 'console',
      keep: (event) => !isList(args.logLevel) || args.logLevel.includes(event.console_level),
    }),
  ),
  getNetworkRequests: forJam(({args, jam}) =>
    eventsOf({
      jam,
      field: 'network',
      keep: (event) =>
        !isList(args.statusCode) ||
        args.statusCode.some(
          (status) =>
            String(event.network_status_class) === String(status) ||
            String(event.network_status) === String(status),
        ),
    }),
  ),
  getUserEvents: forJam(({jam}) => eventsOf({jam, field: 'events', keep: () => true})),
  getMetadata: forJam(() => textResult(fixtures.prose.metadata)),
  getVideoTranscript: forJam(({jam}) =>
    jam.transcript === undefined ? notRecorded('getVideoTranscript') : jsonResult(jam.transcript),
  ),
  getVideoChapters: forJam(({jam}) =>
    jam.chapters === undefined ? notRecorded('getVideoChapters') : jsonResult(jam.chapters),
  ),
  searchJams: searchJams,
  getScreenshots: forJam(({jam}) =>
    jam.type === 'video'
      ? textResult(fixtures.prose.noScreenshots)
      : {content: [imageBlock('png')]},
  ),
  getFrames: forJam(({args, jam}) => frames({args, jam})),
  listMembers: () => jsonResult({users: fixtures.members}),
};

// The event reads return `{total, returned, hasMore, nextCursor, events}`.
function eventsOf({jam, field, keep}) {
  const all = jam[field];
  if (all === undefined) return notRecorded(field);
  const events = all.filter(keep);
  return jsonResult({
    total: events.length,
    returned: events.length,
    hasMore: false,
    nextCursor: null,
    events,
  });
}

function searchJams(args) {
  const text = typeof args.text === 'string' ? args.text.toLowerCase() : undefined;
  // Without `textIn` Jam searches every place. The fake holds the title and the transcript.
  const places = isList(args.textIn) ? args.textIn : ['title', 'transcript'];
  const found = Object.values(fixtures.jams).filter((jam) => {
    if (text === undefined) return true;
    return (
      (places.includes('title') && jam.search.title.toLowerCase().includes(text)) ||
      (places.includes('transcript') &&
        (jam.transcript?.transcript ?? '').toLowerCase().includes(text))
    );
  });
  const {v, ...query} = args;
  return jsonResult({
    jams: found
      .map((jam) => jam.search)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    counts: {jams: null},
    page: {limit: 20, hasMore: false},
    executed: {query: {options: {count: 'none', matches: false}, sort: 'newest', ...query, v}},
  });
}

function frames({args, jam}) {
  if (jam.type !== 'video') return textResult(fixtures.prose.notAVideo);
  if (args.overview === true) {
    return {
      content: [{type: 'text', text: fixtures.prose.overview}, imageBlock('jpeg')],
    };
  }
  const times = isList(args.at) ? args.at : frameTimes(args);
  if (times === undefined) {
    return toolError('MCP error -32602: `window.count` must be at most 30.');
  }
  return {
    content: times.flatMap((time) => [
      {type: 'text', text: `t=${time}ms`},
      imageBlock('jpeg'),
    ]),
  };
}

// The timestamps of a window of evenly spaced frames. Jam refuses more than 30 of them.
function frameTimes(args) {
  const count = args.count ?? DEFAULT_FRAMES;
  if (count > MAX_FRAMES) return undefined;
  const from = args.fromMs ?? 0;
  const to = args.toMs ?? from + FRAME_SPAN_MS;
  const step = count > 1 ? (to - from) / (count - 1) : 0;
  return Array.from({length: count}, (_, index) => Math.round(from + step * index));
}

// Jam takes a UUID or the link of a Jam, and answers a Jam it can't resolve or find with an error.
function resolveJam(jamId) {
  const id = typeof jamId === 'string' ? (JAM_URL_RE.exec(jamId)?.[1] ?? jamId) : undefined;
  if (id === undefined || !JAM_ID_RE.test(id)) {
    return {
      error: `MCP error -32602: Could not resolve Jam ID from: ${jamId}. Provide a UUID or a jam.dev URL (e.g., https://jam.dev/c/{uuid}).`,
    };
  }
  const jam = fixtures.jams[id.toLowerCase()];
  if (jam === undefined) return {error: 'JamNotFound: Could not find jam'};
  return {jam};
}

function imageBlock(kind) {
  return {
    type: 'image',
    data: fixtures.images[kind],
    mimeType: kind === 'png' ? 'image/png' : 'image/jpeg',
  };
}

// The mock answers what the sandbox Jams recorded, and says so for a call it has no recording of.
function notRecorded(what) {
  return toolError(`MCP error -32602: The Jam mock has no recording of ${what} for this Jam.`);
}

function isList(value) {
  return Array.isArray(value) && value.length > 0;
}

function textResult(text) {
  return {content: [{type: 'text', text}]};
}

function jsonResult(body) {
  return textResult(JSON.stringify(body));
}

function toolError(text) {
  return {isError: true, content: [{type: 'text', text}]};
}

function bearer(request) {
  const value = request.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ')
    ? value.slice('Bearer '.length)
    : '';
}

async function readJsonBody(request) {
  const body = await consume(request);
  return body.length === 0 ? {} : JSON.parse(body);
}

async function consume(request) {
  const chunks = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(response, status, body) {
  response.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

function sendInvalidToken(response) {
  response
    .writeHead(401, {
      'content-type': 'application/json; charset=utf-8',
      'www-authenticate':
        'Bearer resource_metadata="https://mcp.jam.dev/.well-known/oauth-protected-resource", scope="mcp:read mcp:write"',
    })
    .end(
      JSON.stringify({
        error: 'invalid_token',
        error_description: 'You are not logged in. Please log in and try again.',
      }),
    );
}

function sendMcpError(response, id, error) {
  response
    .writeHead(200, {'content-type': 'application/json', 'mcp-session-id': 'e2e-jam-session'})
    .end(JSON.stringify({jsonrpc: '2.0', id, error}));
}

function sendMcpResult(response, id, result) {
  response
    .writeHead(200, {'content-type': 'application/json', 'mcp-session-id': 'e2e-jam-session'})
    .end(JSON.stringify({jsonrpc: '2.0', id, result}));
}
