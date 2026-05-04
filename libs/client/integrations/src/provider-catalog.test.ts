import {PROVIDER_CATALOG} from './provider-catalog.js';

describe('PROVIDER_CATALOG', () => {
  test('contains entries for github and debug', () => {
    expect(PROVIDER_CATALOG.github?.setupPath).toBe('/setup/integrations/github');
    expect(PROVIDER_CATALOG.debug?.setupPath).toBe('/setup/integrations/debug');
  });

  test('returns undefined for unknown providers (gallery filter behavior)', () => {
    expect(PROVIDER_CATALOG.gitlab).toBeUndefined();
  });
});
