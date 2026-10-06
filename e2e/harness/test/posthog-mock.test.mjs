import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startPosthogMock} from '../src/posthog-mock.mjs';

async function withMock(run) {
  const mock = await startPosthogMock(new URL('http://127.0.0.1:0'));
  try {
    await run(mock.endpoint);
  } finally {
    await mock.stop();
  }
}

async function seed(endpoint, body) {
  const response = await fetch(new URL('/__e2e/seed', endpoint), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
}

async function callJson({endpoint, apiKey, tool, args}) {
  const response = await fetch(new URL('/mcp', endpoint), {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {name: 'exec', arguments: {command: `call --json ${tool} ${JSON.stringify(args)}`}},
    }),
  });
  const {result} = await response.json();
  return {isError: result.isError === true, text: result.content[0].text};
}

const seeded = {
  api_key: 'phx_seeded',
  events: [{name: 'contract_event', count: 40}],
  feature_flags: [
    {id: 301243, key: 'contract-flag'},
    {id: 301244, key: 'contract-flag-disabled', active: false},
  ],
};

test('answers a seeded SQL count as text rows, the count on the last line', async () => {
  await withMock(async (endpoint) => {
    await seed(endpoint, seeded);

    const result = await callJson({
      endpoint,
      apiKey: 'phx_seeded',
      tool: 'execute-sql',
      args: {
        query:
          "SELECT count() FROM events WHERE event = 'contract_event' AND timestamp >= toDateTime('2026-09-01')",
      },
    });

    assert.deepEqual(result, {
      isError: false,
      text: JSON.stringify({results: 'count()\n40'}),
    });
  });
});

test('rejects a SQL query the seed cannot answer', async () => {
  await withMock(async (endpoint) => {
    await seed(endpoint, seeded);

    const result = await callJson({
      endpoint,
      apiKey: 'phx_seeded',
      tool: 'execute-sql',
      args: {query: "SELECT count() FROM events WHERE event = 'unknown'"},
    });

    assert.equal(result.isError, true);
  });
});

test('filters seeded feature flags by key, ignoring case', async () => {
  await withMock(async (endpoint) => {
    await seed(endpoint, seeded);

    const one = await callJson({
      endpoint,
      apiKey: 'phx_seeded',
      tool: 'feature-flag-get-all',
      args: {key: 'CONTRACT-FLAG'},
    });
    const all = await callJson({
      endpoint,
      apiKey: 'phx_seeded',
      tool: 'feature-flag-get-all',
      args: {},
    });

    assert.deepEqual(JSON.parse(one.text).results, [
      {id: 301243, key: 'contract-flag', name: '', active: true, deleted: false},
    ]);
    assert.equal(JSON.parse(all.text).results.length, 2);
    assert.equal(JSON.parse(all.text).results[1].active, false);
  });
});

test('keeps the marker answer for a key without a seed', async () => {
  await withMock(async (endpoint) => {
    await seed(endpoint, seeded);

    const result = await callJson({
      endpoint,
      apiKey: 'phx_other',
      tool: 'execute-sql',
      args: {query: 'SELECT 1'},
    });

    assert.equal(result.text, JSON.stringify({results: 'posthog-e2e-result:execute-sql'}));
  });
});

test('rejects a seed without an api key', async () => {
  await withMock(async (endpoint) => {
    const response = await fetch(new URL('/__e2e/seed', endpoint), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({events: []}),
    });

    assert.equal(response.status, 400);
  });
});
