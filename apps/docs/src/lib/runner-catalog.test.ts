import assert from 'node:assert/strict';
import test from 'node:test';
import {remarkRunnerCatalog} from './remark-runner-catalog';
import {
  createRunnerCatalogClient,
  formatMicrodollars,
  parseRunnerCatalog,
  renderRunnerCatalogMarkdown,
  runnerCatalogClient,
} from './runner-catalog';

const CATALOG_LOAD_ERROR_PATTERN = /public runner catalog could not be loaded/;

const catalog = {
  schema_version: 1,
  catalog_version: '2026-09-10',
  rate_card_version: '2026-09-08',
  effective_at: '2026-09-08T00:00:00.000Z',
  currency: 'USD',
  runners: [
    {
      id: 'shipfox-2cpu',
      label: '2 vCPU',
      aliases: ['shipfox'],
      sku: 'compute.standard.amd64.cpu2',
      class: 'standard',
      operating_system: 'ubuntu-24.04',
      architecture: 'amd64',
      cpu: 2,
      memory_gib: 8,
      workspace_disk_gib: 50,
      system_disk_gib: 30,
      pricing: {unit: 'minute', minimum_seconds: 60, price_microdollars: 6000},
    },
  ],
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

test('groups aliases under one canonical runner row', () => {
  const markdown = renderRunnerCatalogMarkdown(parseRunnerCatalog(catalog));

  assert.equal(
    markdown,
    [
      '| Runner | Compute | Workspace disk | Price |',
      '| --- | ---: | ---: | ---: |',
      '| `shipfox-2cpu`<br />Alias: `shipfox` | 2 vCPU · 8 GiB | 50 GiB | $0.006/minute |',
    ].join('\n'),
  );
});

test('formats integer microdollar values without losing precision', () => {
  assert.equal(formatMicrodollars(6000), '$0.006');
  assert.equal(formatMicrodollars(2_100_000), '$2.1');
  assert.equal(formatMicrodollars(3_000_000), '$3');
});

test('rejects duplicate canonical IDs and aliases', () => {
  assert.throws(() =>
    parseRunnerCatalog({
      ...catalog,
      runners: [catalog.runners[0], {...catalog.runners[0], id: 'shipfox-4cpu'}],
    }),
  );

  assert.throws(() =>
    parseRunnerCatalog({
      ...catalog,
      runners: [{...catalog.runners[0], aliases: ['shipfox-2cpu']}],
    }),
  );
});

test('caches validated responses and reuses the last response after a failure', async () => {
  let now = 0;
  let calls = 0;
  const client = createRunnerCatalogClient({
    baseUrl: 'https://api.example.test',
    now: () => now,
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve(response(catalog));
    },
  });

  const first = await client.get();
  const second = await client.get();

  assert.equal(first, second);
  assert.equal(calls, 1);

  now = 301_000;
  const staleClient = createRunnerCatalogClient({
    baseUrl: 'https://api.example.test',
    now: () => now,
    cache: {catalog: first, fetchedAt: 0},
    fetchImpl: async () => response({}, 503),
  });
  assert.equal(await staleClient.get(), first);
});

test('fails when the response fails before a successful catalog is cached', async () => {
  const client = createRunnerCatalogClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () => response({message: 'private failure'}, 502),
  });

  await assert.rejects(client.get(), CATALOG_LOAD_ERROR_PATTERN);
});

test('fails closed for private fields and invalid response data', async () => {
  const client = createRunnerCatalogClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () =>
      response({
        ...catalog,
        runners: [{...catalog.runners[0], deployment: {aws: {instance_type: 'm8a.large'}}}],
      }),
  });

  await assert.rejects(client.get(), CATALOG_LOAD_ERROR_PATTERN);
});

test('does not load the catalog when a document has no RunnerCatalog component', async (t) => {
  let calls = 0;
  t.mock.method(runnerCatalogClient, 'get', () => {
    calls += 1;
    return parseRunnerCatalog(catalog);
  });

  await remarkRunnerCatalog()({children: [{type: 'paragraph', children: []}]});

  assert.equal(calls, 0);
});

test('serializes every RunnerCatalog component after loading the catalog', async (t) => {
  let calls = 0;
  t.mock.method(runnerCatalogClient, 'get', () => {
    calls += 1;
    return parseRunnerCatalog(catalog);
  });
  const first = {
    type: 'mdxJsxFlowElement' as const,
    name: 'RunnerCatalog',
    children: [],
    data: undefined as Record<string, unknown> | undefined,
  };
  const second = {
    type: 'mdxJsxTextElement' as const,
    name: 'RunnerCatalog',
    children: [],
    data: undefined as Record<string, unknown> | undefined,
  };

  await remarkRunnerCatalog()({children: [first, {children: [second]}]});

  const text = renderRunnerCatalogMarkdown(parseRunnerCatalog(catalog));
  assert.equal(calls, 1);
  assert.deepEqual(first.data, {_stringify: {text}});
  assert.deepEqual(second.data, {_stringify: {text}});
});
