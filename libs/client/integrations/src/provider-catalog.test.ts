import {PROVIDER_CATALOG} from './provider-catalog.js';

describe('PROVIDER_CATALOG', () => {
  test('contains entries for github, sentry, and debug', () => {
    expect(PROVIDER_CATALOG.github?.setupPath).toBe('/workspaces/$wid/integrations/github');
    expect(PROVIDER_CATALOG.sentry?.setupPath).toBe('/workspaces/$wid/integrations/sentry');
    expect(PROVIDER_CATALOG.debug?.setupPath).toBe('/workspaces/$wid/integrations/debug');
  });

  test('marks providers with the install behavior their pages implement', () => {
    expect(PROVIDER_CATALOG.github?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.sentry?.kind).toBe('redirect-install');
    expect(PROVIDER_CATALOG.debug?.kind).toBe('direct-connect');
  });

  test('returns undefined for unknown providers (gallery filter behavior)', () => {
    expect(PROVIDER_CATALOG.gitlab).toBeUndefined();
  });
});
