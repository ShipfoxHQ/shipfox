import {CLAAP_PROVIDER, createClaapIntegrationProvider} from './index.js';

describe('Claap provider', () => {
  it('registers the Claap provider without an event catalog', () => {
    const provider = createClaapIntegrationProvider();

    expect(provider.provider).toBe(CLAAP_PROVIDER);
    expect(provider.displayName).toBe('Claap');
    expect('adapters' in provider).toBe(false);
    expect('eventCatalog' in provider).toBe(false);
  });
});
