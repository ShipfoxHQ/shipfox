import {once} from 'node:events';
import {createServer} from 'node:http';

const WORKSPACE_SCOPED_TOOLS = new Set([
  'get_recordings',
  'get_recording',
  'get_recording_transcript',
  'search_recording_transcripts',
]);
const RECORDING_TOOLS = new Set(['get_recording', 'get_recording_transcript']);
const DEFAULT_LIMIT = 10;
const WHITESPACE_RE = /\s+/u;

/**
 * The E2E deployment's Claap double. It serves Claap's stateless MCP at `/mcp`: every JSON-RPC
 * request is a plain POST answered with JSON and no session ID. It answers the five read tools
 * Shipfox exposes, and records every tool call by key.
 *
 * The fake holds no data of its own. `/__e2e/seed` gives a key its Claap workspace and the
 * recordings in it. Claap answers a key it does not know with HTTP 401 and an empty body on
 * every request, and so does the fake for a key without a seed, a key that contains `revoked`,
 * and a key revoked through the control route. A key that contains `stale` holds each tool call
 * until the control route releases it.
 */
export async function startClaapMock(endpoint) {
  const state = {
    calls: [],
    mcpRequestCounts: new Map(),
    seeds: new Map(),
    revoked: new Set(),
    pending: new Map(),
  };
  const server = createServer((request, response) => {
    void handleRequest({state, endpoint, request, response}).catch((error) => {
      process.stderr.write(`Claap mock request failed: ${String(error)}\n`);
      if (!response.headersSent) sendJson(response, 500, {error: 'E2E Claap mock failure'});
      else response.end();
    });
  });

  server.listen({host: endpoint.hostname, port: Number(endpoint.port)});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected Claap mock TCP address.');
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);

  return {
    endpoint: boundEndpoint,
    calls: state.calls,
    stop: async () => {
      for (const waiters of state.pending.values()) {
        for (const waiter of waiters) waiter({status: 401});
      }
      server.close();
      server.closeAllConnections();
      await once(server, 'close');
    },
  };
}

async function handleRequest({state, endpoint, request, response}) {
  const url = new URL(request.url ?? '/', endpoint);
  if (url.pathname === '/__e2e/calls' && request.method === 'GET') {
    const apiKey = url.searchParams.get('api_key');
    sendJson(
      response,
      200,
      apiKey ? state.calls.filter((call) => call.api_key === apiKey) : state.calls,
    );
    return;
  }
  if (url.pathname === '/__e2e/mcp-request-count' && request.method === 'GET') {
    const apiKey = url.searchParams.get('api_key');
    sendJson(response, 200, {count: apiKey ? (state.mcpRequestCounts.get(apiKey) ?? 0) : 0});
    return;
  }
  if (url.pathname === '/__e2e/seed' && request.method === 'POST') {
    await handleSeed({state, request, response});
    return;
  }
  if (url.pathname === '/__e2e/control' && request.method === 'POST') {
    await handleControl({state, request, response});
    return;
  }
  if (url.pathname === '/mcp') {
    await handleMcp({state, request, response});
    return;
  }
  response.writeHead(404).end();
}

// Gives a key its Claap workspace and the recordings in it, in place of an earlier seed.
async function handleSeed({state, request, response}) {
  const body = await readJsonBody(request);
  const workspace = body?.workspace;
  if (
    typeof body?.api_key !== 'string' ||
    typeof workspace?.workspaceId !== 'string' ||
    typeof workspace.name !== 'string' ||
    !Array.isArray(body.recordings)
  ) {
    sendJson(response, 400, {
      error: 'api_key, workspace.workspaceId, workspace.name, and recordings are required',
    });
    return;
  }
  state.seeds.set(body.api_key, {
    workspace: {workspaceId: workspace.workspaceId, name: workspace.name},
    recordings: body.recordings,
  });
  sendJson(response, 200, {ok: true});
}

// `revoke_api_key` makes the key fail like a revoked one from now on. `release_api_key` answers the
// calls held for a stale key: with HTTP 401 once the key is revoked, otherwise with the result.
async function handleControl({state, request, response}) {
  const body = await readJsonBody(request);
  if (typeof body?.revoke_api_key === 'string') state.revoked.add(body.revoke_api_key);
  if (typeof body?.release_api_key === 'string') {
    const waiters = state.pending.get(body.release_api_key) ?? [];
    state.pending.delete(body.release_api_key);
    for (const waiter of waiters) {
      waiter(isRejected({apiKey: body.release_api_key, state}) ? {status: 401} : {});
    }
  }
  sendJson(response, 200, {ok: true});
}

async function handleMcp({state, request, response}) {
  const apiKey = bearer(request);
  state.mcpRequestCounts.set(apiKey, (state.mcpRequestCounts.get(apiKey) ?? 0) + 1);
  // Claap checks the key before anything else, on every request.
  if (isRejected({apiKey, state})) {
    await consume(request);
    response.writeHead(401).end();
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405).end();
    return;
  }
  const body = parseJson(await consume(request));
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    sendJson(response, 400, {
      jsonrpc: '2.0',
      id: null,
      error: {code: -32600, message: 'Invalid Request'},
    });
    return;
  }
  if (body.method === 'initialize') {
    sendMcpResult(response, body.id, {
      protocolVersion: body.params?.protocolVersion ?? '2025-06-18',
      capabilities: {tools: {}},
      serverInfo: {name: 'claap-e2e-mock', version: '0.0.0'},
    });
    return;
  }
  if (body.method === 'tools/list') {
    sendMcpResult(response, body.id, {tools: TOOL_LIST});
    return;
  }
  if (body.method === 'tools/call') {
    await handleToolCall({state, apiKey, body, response});
    return;
  }
  // A notification, such as `notifications/initialized`, has no id and gets no JSON-RPC answer.
  if (body.id === undefined) {
    response.writeHead(202).end();
    return;
  }
  sendMcpError(response, body.id, {code: -32601, message: `Method not found: ${body.method}`});
}

async function handleToolCall({state, apiKey, body, response}) {
  const args = body.params?.arguments ?? {};
  state.calls.push({kind: 'mcp', api_key: apiKey, tool_name: body.params?.name, arguments: args});
  if (apiKey.includes('stale')) {
    const released = await new Promise((resolve) => {
      state.pending.set(apiKey, [...(state.pending.get(apiKey) ?? []), resolve]);
    });
    if (released.status === 401) {
      response.writeHead(401).end();
      return;
    }
  }
  sendMcpResult(
    response,
    body.id,
    toolResult({tool: body.params?.name, args, seed: state.seeds.get(apiKey)}),
  );
}

function isRejected({apiKey, state}) {
  return !state.seeds.has(apiKey) || apiKey.includes('revoked') || state.revoked.has(apiKey);
}

function toolResult({tool, args, seed}) {
  const read = TOOLS.get(tool);
  if (read === undefined) return toolError(`MCP error -32602: Tool ${tool} not found`);
  if (WORKSPACE_SCOPED_TOOLS.has(tool)) {
    if (typeof args.workspaceId !== 'string') {
      return toolError(
        'MCP error -32602: Input validation error: Invalid arguments for tool: workspaceId is required',
      );
    }
    if (args.workspaceId !== seed.workspace.workspaceId) {
      return toolError(`Unauthorized: no access to this workspaceId (${args.workspaceId})`);
    }
  }
  if (RECORDING_TOOLS.has(tool) && typeof args.recordingId !== 'string') {
    return toolError(
      'MCP error -32602: Input validation error: Invalid arguments for tool: recordingId is required',
    );
  }
  return read({args, seed});
}

// A Map, so a tool name such as `constructor` never reaches a built-in of a plain object.
const TOOLS = new Map([
  ['list_workspaces', ({seed}) => jsonResult({workspaces: [seed.workspace]})],
  ['get_recordings', listRecordings],
  [
    'get_recording',
    ({args, seed}) =>
      withRecording({seed, recordingId: args.recordingId}, (recording) =>
        jsonResult({
          recording: metadata(recording),
          ...(recording.summary === undefined ? {} : {summary: recording.summary}),
        }),
      ),
  ],
  [
    'get_recording_transcript',
    ({args, seed}) =>
      withRecording({seed, recordingId: args.recordingId}, (recording) =>
        jsonResult({
          transcript: recording.transcript
            .map((line) => `${line.speaker}: ${line.text}\n`)
            .join(''),
        }),
      ),
  ],
  ['search_recording_transcripts', searchTranscripts],
]);

function listRecordings({args, seed}) {
  const filters = args.filters ?? {};
  const found = seed.recordings.filter(
    (recording) =>
      (!isList(filters.recordingId) || filters.recordingId.includes(recording.recordingId)) &&
      (typeof filters.recordingTitle !== 'string' ||
        recording.title.toLowerCase().includes(filters.recordingTitle.toLowerCase())),
  );
  const {items, nextCursor} = page({items: found, args});
  return jsonResult({
    total: found.length,
    ...(nextCursor === undefined ? {} : {nextCursor}),
    recordings: items.map(metadata),
  });
}

function searchTranscripts({args, seed}) {
  const query = args.search?.query;
  const type = args.search?.type;
  if (typeof query !== 'string' || (type !== 'keyword' && type !== 'semantic')) {
    return toolError(
      'MCP error -32602: Input validation error: Invalid arguments for tool: search.query and search.type are required',
    );
  }
  const words = query.toLowerCase().split(WHITESPACE_RE).filter(Boolean);
  // Keyword search needs every word in a chunk. The fake reads a semantic query the same way.
  const found = seed.recordings.flatMap((recording) => {
    const chunks = recording.transcript
      .map((line, index) => ({line, index}))
      .filter(({line}) => words.every((word) => line.text.toLowerCase().includes(word)))
      .map(({line, index}) => ({
        chunkId: `${recording.recordingId}-chunk-${index}`,
        text: `${timestamp(index)} ${line.speaker}: ${line.text}`,
        score: 1,
      }));
    if (chunks.length === 0) return [];
    const {recordingId, title, url, speakers, companies} = metadata(recording);
    return [{recordingId, title, url, speakers, companies, chunks}];
  });
  const {items, nextCursor} = page({items: found, args});
  // Claap returns `total` only for keyword search.
  return jsonResult({
    ...(type === 'keyword' ? {total: found.length} : {}),
    ...(nextCursor === undefined ? {} : {nextCursor}),
    recordings: items,
  });
}

// A cursor is the offset of the next page. Claap's own cursor is opaque.
function page({items, args}) {
  const limit = typeof args.limit === 'number' ? args.limit : DEFAULT_LIMIT;
  const offset = typeof args.cursor === 'string' ? Number(args.cursor) || 0 : 0;
  const end = offset + limit;
  return {
    items: items.slice(offset, end),
    ...(end < items.length ? {nextCursor: String(end)} : {}),
  };
}

function withRecording({seed, recordingId}, read) {
  const recording = seed.recordings.find((candidate) => candidate.recordingId === recordingId);
  if (recording === undefined) return toolError('Recording not found');
  return read(recording);
}

// The metadata fields Claap returns, with each speaker of the transcript as a person.
function metadata(recording) {
  const names = [...new Set(recording.transcript.map((line) => line.speaker))];
  return {
    recordingId: recording.recordingId,
    title: recording.title,
    createdAt: recording.createdAt,
    url: recording.url,
    people: names.map((name) => ({name})),
    speakers: names.map((name, index) => ({
      speakerId: `speaker_${index}`,
      name,
      isExternal: false,
    })),
    companies: [],
    labels: [],
  };
}

// Each transcript line stands for ten seconds of the recording.
function timestamp(index) {
  const seconds = index * 10;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

const workspaceIdProperty = {workspaceId: {type: 'string'}};
const recordingIdProperty = {recordingId: {type: 'string'}};
const TOOL_LIST = [
  {name: 'list_workspaces', inputSchema: {type: 'object', properties: {}}},
  {
    name: 'get_recordings',
    inputSchema: {type: 'object', properties: workspaceIdProperty, required: ['workspaceId']},
  },
  {
    name: 'get_recording',
    inputSchema: {
      type: 'object',
      properties: {...workspaceIdProperty, ...recordingIdProperty},
      required: ['recordingId', 'workspaceId'],
    },
  },
  {
    name: 'get_recording_transcript',
    inputSchema: {
      type: 'object',
      properties: {...workspaceIdProperty, ...recordingIdProperty},
      required: ['recordingId', 'workspaceId'],
    },
  },
  {
    name: 'search_recording_transcripts',
    inputSchema: {
      type: 'object',
      properties: {...workspaceIdProperty, search: {type: 'object'}},
      required: ['search', 'workspaceId'],
    },
  },
].map((tool) => ({...tool, description: `E2E ${tool.name}`, annotations: {readOnlyHint: true}}));

function isList(value) {
  return Array.isArray(value) && value.length > 0;
}

// Claap returns each result as `structuredContent` and as the same JSON in a text block.
function jsonResult(body) {
  return {structuredContent: body, content: [{type: 'text', text: JSON.stringify(body)}]};
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

function parseJson(text) {
  try {
    return text.length === 0 ? {} : JSON.parse(text);
  } catch {
    return null;
  }
}

async function readJsonBody(request) {
  return parseJson(await consume(request));
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

function sendMcpResult(response, id, result) {
  sendJson(response, 200, {jsonrpc: '2.0', id, result});
}

function sendMcpError(response, id, error) {
  sendJson(response, 200, {jsonrpc: '2.0', id, error});
}
