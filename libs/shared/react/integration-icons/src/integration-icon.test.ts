import {getIntegrationIcon} from './integration-icon.js';
import {FALLBACK_INTEGRATION_ICON} from './provider-icons.js';

describe('getIntegrationIcon', () => {
  it('resolves cataloged providers to the icon they declare', () => {
    expect(getIntegrationIcon('github')).toBe('github');
    expect(getIntegrationIcon('sentry')).toBe('sentry');
    expect(getIntegrationIcon('linear')).toBe('linear');
    expect(getIntegrationIcon('gitea')).toBe('gitea');
  });

  it('falls back for sources missing from the catalog', () => {
    expect(getIntegrationIcon('gitlab')).toBe(FALLBACK_INTEGRATION_ICON);
    expect(getIntegrationIcon('mystery')).toBe(FALLBACK_INTEGRATION_ICON);
  });

  it.each([['' as const], [null], [undefined]])('falls back for an empty source (%s)', (source) => {
    expect(getIntegrationIcon(source)).toBe(FALLBACK_INTEGRATION_ICON);
  });
});
