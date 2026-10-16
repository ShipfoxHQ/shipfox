import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startClaapMock} from '../src/claap-mock.mjs';

const API_KEY = 'cla_e2e';
const WORKSPACE = {workspaceId: 'mockWs1', name: 'Mock'};
const FRENCH = {
  recordingId: 'frenchRec01',
  title: 'Appel',
  url: 'https://app.claap.io/appel-c-mockWs1-frenchRec01',
  createdAt: '2026-10-16',
  transcript: [{speaker: 'Noé', text: 'Bonjour, enchanté de vous rencontrer.'}],
};
const SUMMARIZED = {
  recordingId: 'summaryRec1',
  title: 'Demo',
  url: 'https://app.claap.io/demo-c-mockWs1-summaryRec1',
  createdAt: '2026-10-15',
  transcript: [
    {speaker: 'Ada', text: 'Welcome.'},
    {speaker: 'Grace', text: 'Connect your calendar.'},
  ],
  summary: {markdown: '- Welcome %[00:00]()', state: 'Ready'},
};
const OTHER = {...FRENCH, recordingId: 'otherRec001', title: 'Other'};
const WORKSPACE_REFUSAL_RE = /^Unauthorized: no access to this workspaceId/u;

async function withMock(run) {
  const mock = await startClaapMock(new URL('http://127.0.0.1:0/mcp'));
  try {
    await seed(mock.endpoint, {
      api_key: API_KEY,
      workspace: WORKSPACE,
      recordings: [FRENCH, SUMMARIZED, OTHER],
    });
    await run(mock.endpoint);
  } finally {
    await mock.stop();
  }
}

async function post({endpoint, path, body}) {
  const response = await fetch(new URL(path, endpoint), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
}

function seed(endpoint, body) {
  return post({endpoint, path: '/__e2e/seed', body});
}

function mcpRequest({endpoint, apiKey = API_KEY, body}) {
  return fetch(new URL('/mcp', endpoint), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${apiKey}`,
    },
    body: typeof body === 'string' ? body : JSON.stringify({jsonrpc: '2.0', id: 1, ...body}),
  });
}

async function callTool({endpoint, apiKey, tool, args = {}}) {
  const response = await mcpRequest({
    endpoint,
    apiKey,
    body: {method: 'tools/call', params: {name: tool, arguments: args}},
  });
  assert.equal(response.status, 200);
  const {result} = await response.json();
  return result;
}

async function readCalls(endpoint, apiKey) {
  const response = await fetch(new URL(`/__e2e/calls?api_key=${apiKey}`, endpoint));
  return await response.json();
}

test('answers initialize statelessly, with no session ID', async () => {
  await withMock(async (endpoint) => {
    const response = await mcpRequest({
      endpoint,
      body: {method: 'initialize', params: {protocolVersion: '2025-06-18'}},
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('mcp-session-id'), null);
    assert.equal((await response.json()).result.protocolVersion, '2025-06-18');
  });
});

test('lists the workspace the seed gives the key', async () => {
  await withMock(async (endpoint) => {
    const result = await callTool({endpoint, tool: 'list_workspaces'});

    assert.deepEqual(result.structuredContent, {workspaces: [WORKSPACE]});
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  });
});

test('reads a seeded recording with its summary and its speakers', async () => {
  await withMock(async (endpoint) => {
    const result = await callTool({
      endpoint,
      tool: 'get_recording',
      args: {workspaceId: WORKSPACE.workspaceId, recordingId: SUMMARIZED.recordingId},
    });

    assert.equal(result.structuredContent.recording.url, SUMMARIZED.url);
    assert.deepEqual(
      result.structuredContent.recording.speakers.map((speaker) => speaker.name),
      ['Ada', 'Grace'],
    );
    assert.deepEqual(result.structuredContent.summary, SUMMARIZED.summary);
  });
});

test('refuses a workspace ID that is not the key workspace', async () => {
  await withMock(async (endpoint) => {
    const result = await callTool({
      endpoint,
      tool: 'get_recordings',
      args: {workspaceId: 'otherWs1'},
    });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, WORKSPACE_REFUSAL_RE);
  });
});

test('reads a transcript with one line per speaker turn and its accents', async () => {
  await withMock(async (endpoint) => {
    const result = await callTool({
      endpoint,
      tool: 'get_recording_transcript',
      args: {workspaceId: WORKSPACE.workspaceId, recordingId: FRENCH.recordingId},
    });

    assert.deepEqual(result.structuredContent, {
      transcript: 'Noé: Bonjour, enchanté de vous rencontrer.\n',
    });
  });
});

test('answers a missing recording as Claap does', async () => {
  await withMock(async (endpoint) => {
    const result = await callTool({
      endpoint,
      tool: 'get_recording',
      args: {workspaceId: WORKSPACE.workspaceId, recordingId: 'missingRec01'},
    });

    assert.deepEqual(result, {
      isError: true,
      content: [{type: 'text', text: 'Recording not found'}],
    });
  });
});

test('answers a tool name that is a built-in object key as an unknown tool', async () => {
  await withMock(async (endpoint) => {
    const result = await callTool({endpoint, tool: 'constructor'});

    assert.deepEqual(result, {
      isError: true,
      content: [{type: 'text', text: 'MCP error -32602: Tool constructor not found'}],
    });
  });
});

test('pages the recordings with a cursor', async () => {
  await withMock(async (endpoint) => {
    const first = await callTool({
      endpoint,
      tool: 'get_recordings',
      args: {workspaceId: WORKSPACE.workspaceId, limit: 2},
    });
    const second = await callTool({
      endpoint,
      tool: 'get_recordings',
      args: {
        workspaceId: WORKSPACE.workspaceId,
        limit: 2,
        cursor: first.structuredContent.nextCursor,
      },
    });

    assert.equal(first.structuredContent.total, 3);
    assert.equal(first.structuredContent.recordings.length, 2);
    assert.equal(second.structuredContent.nextCursor, undefined);
    assert.deepEqual(
      second.structuredContent.recordings.map((recording) => recording.recordingId),
      [OTHER.recordingId],
    );
  });
});

test('finds a keyword in the transcript chunks', async () => {
  await withMock(async (endpoint) => {
    const result = await callTool({
      endpoint,
      tool: 'search_recording_transcripts',
      args: {workspaceId: WORKSPACE.workspaceId, search: {query: 'calendar', type: 'keyword'}},
    });

    assert.equal(result.structuredContent.total, 1);
    assert.equal(result.structuredContent.recordings[0].recordingId, SUMMARIZED.recordingId);
    assert.equal(
      result.structuredContent.recordings[0].chunks[0].text,
      '00:10 Grace: Connect your calendar.',
    );
  });
});

test('records each tool call with its arguments, by key', async () => {
  await withMock(async (endpoint) => {
    await callTool({endpoint, tool: 'list_workspaces'});

    assert.deepEqual(await readCalls(endpoint, API_KEY), [
      {kind: 'mcp', api_key: API_KEY, tool_name: 'list_workspaces', arguments: {}},
    ]);
  });
});

test('rejects an unseeded or revoked key with HTTP 401 and an empty body', async () => {
  await withMock(async (endpoint) => {
    await seed(endpoint, {api_key: 'cla_revoked', workspace: WORKSPACE, recordings: []});

    for (const apiKey of ['cla_unseeded', 'cla_revoked']) {
      const response = await mcpRequest({endpoint, apiKey, body: {method: 'initialize'}});

      assert.equal(response.status, 401);
      assert.equal(await response.text(), '');
    }
  });
});

test('rejects a revoked key with HTTP 401 even when its body is not JSON', async () => {
  await withMock(async (endpoint) => {
    await post({endpoint, path: '/__e2e/control', body: {revoke_api_key: API_KEY}});

    const response = await mcpRequest({endpoint, body: '{not json'});

    assert.equal(response.status, 401);
  });
});

test('answers a malformed body from a live key with a JSON-RPC error', async () => {
  await withMock(async (endpoint) => {
    const response = await mcpRequest({endpoint, body: '{not json'});

    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, -32600);
  });
});

test('fails a held call with HTTP 401 once its key is revoked', async () => {
  await withMock(async (endpoint) => {
    await seed(endpoint, {api_key: 'cla_stale', workspace: WORKSPACE, recordings: []});
    const held = mcpRequest({
      endpoint,
      apiKey: 'cla_stale',
      body: {method: 'tools/call', params: {name: 'list_workspaces', arguments: {}}},
    });
    while ((await readCalls(endpoint, 'cla_stale')).length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await post({endpoint, path: '/__e2e/control', body: {revoke_api_key: 'cla_stale'}});
    await post({endpoint, path: '/__e2e/control', body: {release_api_key: 'cla_stale'}});

    assert.equal((await held).status, 401);
  });
});
