import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ModelCatalogTable} from '@/app/components/model-catalog';
import {serializeMachineReadableMarkdown} from './machine-readable';
import {
  createModelCatalogClient,
  formatMicrodollars,
  type ModelCatalog,
  modelCatalogSchema,
  serializeModelCatalog,
} from './model-catalog';

const catalog: ModelCatalog = {
  schema_version: 1,
  catalog_version: '2026-09-10',
  rate_card_version: '2026-09-08',
  effective_at: '2026-09-08T00:00:00.000Z',
  currency: 'USD',
  pricing_policy: {
    type: 'reference-rate-markup',
    markup_basis_points: 500,
  },
  models: [
    {
      id: 'gpt-5.6-luna',
      label: 'GPT 5.6 Luna',
      sku: 'inference.gpt-5.6-luna',
      capabilities: {
        context_window_tokens: 1_050_000,
        max_output_tokens: 128_000,
        image_input: true,
        reasoning: true,
      },
      pricing: {
        input: {unit: 'million_tokens', price_microdollars: 210_000},
        cached_input: {unit: 'million_tokens', price_microdollars: 21_000},
        cache_write: {unit: 'million_tokens', price_microdollars: 262_500},
        output: {unit: 'million_tokens', price_microdollars: 1_260_000},
        web_search: {unit: 'thousand_requests', price_microdollars: 14_700_000},
      },
    },
  ],
};

test('formats microdollar prices without floating-point rounding', () => {
  assert.equal(formatMicrodollars(0), '$0.00');
  assert.equal(formatMicrodollars(210_000), '$0.21');
  assert.equal(formatMicrodollars(1_000_001), '$1.000001');
  assert.equal(formatMicrodollars(14_700_000), '$14.70');
});

test('validates the public model catalog allowlist and pricing dimensions', () => {
  assert.deepEqual(modelCatalogSchema.parse(catalog), catalog);

  const privateFieldResponse = {
    ...catalog,
    models: [{...catalog.models[0], gateway_model: 'private/model'}],
  };
  assert.equal(modelCatalogSchema.safeParse(privateFieldResponse).success, false);

  const wrongUnitResponse = {
    ...catalog,
    models: [
      {
        ...catalog.models[0],
        pricing: {
          ...catalog.models[0].pricing,
          input: {unit: 'thousand_requests', price_microdollars: 1},
        },
      },
    ],
  };
  assert.equal(modelCatalogSchema.safeParse(wrongUnitResponse).success, false);
});

test('renders the same catalog values in HTML and machine-readable Markdown', () => {
  const html = renderToStaticMarkup(createElement(ModelCatalogTable, {catalog}));
  const markdown = serializeModelCatalog(catalog);
  const serializedComponent = serializeMachineReadableMarkdown(
    '\0{"name":"ModelCatalog","children":"","attributes":{}}\0',
    {modelCatalog: catalog},
  );

  assert.ok(html.includes('GPT 5.6 Luna'));
  assert.ok(html.includes('gpt-5.6-luna'));
  assert.ok(html.includes('$0.21'));
  assert.ok(html.includes('Context: 1,050,000 tokens'));
  assert.ok(markdown.includes('| GPT 5.6 Luna | `gpt-5.6-luna` |'));
  assert.ok(markdown.includes('$14.70'));
  assert.equal(serializedComponent, markdown);
});

test('retains the last successful catalog during revalidation failures', async () => {
  const response = new Response(JSON.stringify(catalog), {status: 200});
  let fetchFailure: Error | undefined;
  const requests: Array<{url: string; init: RequestInit & {next?: unknown}}> = [];
  const client = createModelCatalogClient({
    apiUrl: 'https://api.shipfox.test/',
    fetcher: (url, init) => {
      requests.push({url: url.toString(), init});
      if (fetchFailure) return Promise.reject(fetchFailure);
      return Promise.resolve(response);
    },
  });

  const first = await client.getModelCatalog();
  fetchFailure = new Error('temporary outage');
  const stale = await client.getModelCatalog();

  assert.equal(stale, first);
  assert.equal(requests[0]?.url, 'https://api.shipfox.test/catalog/models');
  assert.deepEqual(requests[0]?.init.next, {revalidate: 300, tags: ['model-catalog']});
});

test('fails when the first catalog request is unavailable', async () => {
  const client = createModelCatalogClient({
    apiUrl: 'https://api.shipfox.test',
    fetcher: () => {
      throw new Error('temporary outage');
    },
  });

  await assert.rejects(client.getModelCatalog(), {message: 'temporary outage'});
});

test('retains the last successful catalog after an HTTP revalidation failure', async () => {
  let response = new Response(JSON.stringify(catalog), {status: 200});
  const client = createModelCatalogClient({
    apiUrl: 'https://api.shipfox.test',
    fetcher: () => Promise.resolve(response),
  });

  const first = await client.getModelCatalog();
  response = new Response('', {status: 503});

  assert.equal(await client.getModelCatalog(), first);
});

test('retains the last successful catalog after an invalid revalidation response', async () => {
  let response = new Response(JSON.stringify(catalog), {status: 200});
  const client = createModelCatalogClient({
    apiUrl: 'https://api.shipfox.test',
    fetcher: async () => response,
  });

  const first = await client.getModelCatalog();
  response = new Response(JSON.stringify({...catalog, schema_version: 2}), {status: 200});

  assert.equal(await client.getModelCatalog(), first);
});
