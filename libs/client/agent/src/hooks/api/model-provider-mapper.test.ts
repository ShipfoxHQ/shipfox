import {
  modelProviderCatalogResponse,
  modelProviderConfigsResponse,
  modelProviderEntry,
} from '#test/fixtures/model-providers.js';
import {toProviderCatalog, toProviderConfiguration} from './model-provider-mapper.js';

test('maps provider catalog entries before they reach the client domain', () => {
  const catalog = toProviderCatalog(modelProviderCatalogResponse([modelProviderEntry()]));

  expect(catalog.providers).toEqual([
    expect.objectContaining({
      kind: 'supported',
      defaultModel: 'claude-opus-4-8',
      credentialFields: [{key: 'api_key', label: 'API key', secret: true}],
    }),
  ]);
});

test('maps configuration response defaults and provider config fields', () => {
  const configuration = toProviderConfiguration(modelProviderConfigsResponse());

  expect(configuration.defaultProviderId).toBe('anthropic');
  expect(configuration.configs[0]).toEqual(
    expect.objectContaining({providerId: 'anthropic', defaultModel: null}),
  );
});
