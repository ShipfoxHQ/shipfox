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
  insights: [{id: 6355500, short_id: 'wTSHwcPR', name: 'Contract insight', event: 'contract_event'}],
  dashboards: [{id: 999696, name: 'Contract dashboard'}],
  experiments: [
    {id: 99531, name: 'Contract experiment'},
    {
      id: 99702,
      name: 'Contract results experiment',
      feature_flag_key: 'contract-results-experiment',
      results: {exposures: 30, control_sum: 30, test_sum: 45},
    },
  ],
  surveys: [{id: 'survey-1', name: 'Contract survey', questions: ['What do you think?']}],
  error_issues: [{id: 'issue-1', name: 'ContractError'}],
};

async function callSeeded(endpoint, tool, args = {}) {
  await seed(endpoint, seeded);
  const result = await callJson({endpoint, apiKey: 'phx_seeded', tool, args});
  assert.equal(result.isError, false, result.text);
  return result.text;
}

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

test('lists the events of the data schema as plain text', async () => {
  await withMock(async (endpoint) => {
    const text = await callSeeded(endpoint, 'read-data-schema', {query: {kind: 'events'}});

    assert.equal(text, 'events:\n- `All events`\n- `contract_event`');
  });
});

test('answers one feature flag by id', async () => {
  await withMock(async (endpoint) => {
    const text = await callSeeded(endpoint, 'feature-flag-get-definition', {id: 301244});

    assert.deepEqual(JSON.parse(text), {
      id: 301244,
      key: 'contract-flag-disabled',
      name: '',
      active: false,
      deleted: false,
    });
  });
});

test('answers a seeded insight in a list, alone, and with the count of its event', async () => {
  await withMock(async (endpoint) => {
    const insight = {id: 6355500, short_id: 'wTSHwcPR', name: 'Contract insight'};

    const list = await callSeeded(endpoint, 'insights-list', {search: 'contract INSIGHT'});
    const one = await callSeeded(endpoint, 'insight-get', {id: 6355500});
    const query = await callSeeded(endpoint, 'insight-query', {insightId: 6355500});

    assert.deepEqual(JSON.parse(list), {count: 1, results: [insight]});
    assert.deepEqual(JSON.parse(one), insight);
    assert.deepEqual(JSON.parse(query), {
      insight,
      results: [{count: 40, label: 'contract_event'}],
    });
  });
});

test('answers a seeded dashboard in a list, as JSON inside text, and with no insight to run', async () => {
  await withMock(async (endpoint) => {
    const list = await callSeeded(endpoint, 'dashboards-get-all', {search: 'none'});
    const one = await callSeeded(endpoint, 'dashboard-get', {id: 999696});
    const run = await callSeeded(endpoint, 'dashboard-insights-run', {id: 999696});

    assert.deepEqual(JSON.parse(list), {count: 0, results: []});
    assert.match(JSON.parse(one).content, /"id":999696,"name":"Contract dashboard"/u);
    assert.deepEqual(JSON.parse(run).results, []);
    assert.equal(typeof JSON.parse(run)._posthogUrl, 'string');
  });
});

test('answers a seeded error-tracking issue in a list and alone', async () => {
  await withMock(async (endpoint) => {
    const issue = {id: 'issue-1', name: 'ContractError', status: 'active'};

    const list = await callSeeded(endpoint, 'query-error-tracking-issues-list');
    const one = await callSeeded(endpoint, 'query-error-tracking-issue', {issueId: 'issue-1'});

    assert.deepEqual(JSON.parse(list), {hasMore: false, results: [issue]});
    assert.deepEqual(JSON.parse(one), issue);
  });
});

test('answers seeded experiments, with results only for the one that ran', async () => {
  await withMock(async (endpoint) => {
    const list = await callSeeded(endpoint, 'experiment-list', {search: 'results'});
    const draft = await callSeeded(endpoint, 'experiment-get', {id: 99531});
    const results = await callSeeded(endpoint, 'experiment-results-get', {id: 99702});
    const draftResults = await callJson({
      endpoint,
      apiKey: 'phx_seeded',
      tool: 'experiment-results-get',
      args: {id: 99531},
    });

    assert.deepEqual(JSON.parse(list), {
      count: 1,
      results: [{id: 99702, name: 'Contract results experiment', status: 'stopped'}],
    });
    assert.deepEqual(JSON.parse(draft), {
      id: 99531,
      name: 'Contract experiment',
      status: 'draft',
      feature_flag_key: '',
    });
    assert.deepEqual(JSON.parse(results), {
      experiment: {id: 99702, name: 'Contract results experiment', status: 'stopped'},
      exposures: {total_exposures: {control: 30, test: 30}},
      metrics: {
        primary: {
          count: 1,
          results: [
            {
              index: 0,
              data: {
                baseline: {key: 'control', sum: 30},
                variant_results: [{key: 'test', sum: 45}],
              },
            },
          ],
        },
      },
    });
    assert.equal(draftResults.isError, true);
  });
});

test('answers a seeded survey in a list, alone, and with empty stats', async () => {
  await withMock(async (endpoint) => {
    const survey = {id: 'survey-1', name: 'Contract survey', type: 'popover'};
    const question = {id: 'survey-1-question-0', question: 'What do you think?'};

    const list = await callSeeded(endpoint, 'surveys-get-all', {search: 'survey'});
    const one = await callSeeded(endpoint, 'survey-get', {id: 'survey-1'});
    const stats = await callSeeded(endpoint, 'survey-stats', {id: 'survey-1'});

    assert.deepEqual(JSON.parse(list), {count: 1, results: [survey]});
    assert.deepEqual(JSON.parse(one), {...survey, questions: [question]});
    assert.deepEqual(JSON.parse(stats), {
      survey_id: 'survey-1',
      rates: {response_rate: 0, dismissal_rate: 0},
      stats: {},
      per_question_stats: [
        {question_id: question.id, question_text: question.question, response_count: 0},
      ],
    });
  });
});

test('answers a documentation search with a count of pages', async () => {
  await withMock(async (endpoint) => {
    const text = await callSeeded(endpoint, 'docs-search', {query: 'feature flags'});

    assert.match(JSON.parse(text).content, /^Found [0-9]+ relevant documentation page/u);
  });
});

test('fails a read of an id the seed does not hold', async () => {
  await withMock(async (endpoint) => {
    await seed(endpoint, seeded);

    const result = await callJson({
      endpoint,
      apiKey: 'phx_seeded',
      tool: 'feature-flag-get-definition',
      args: {id: 999999999},
    });

    assert.equal(result.isError, true);
  });
});
