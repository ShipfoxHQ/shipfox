import {createJamIntegrationProvider, JAM_PROVIDER} from './index.js';

describe('Jam provider', () => {
  it('registers as Jam without an event catalog', () => {
    const provider = createJamIntegrationProvider();

    expect(provider.provider).toBe(JAM_PROVIDER);
    expect(provider.displayName).toBe('Jam');
    expect('adapters' in provider).toBe(false);
    expect('eventCatalog' in provider).toBe(false);
  });
});
