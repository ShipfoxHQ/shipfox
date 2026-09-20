import {createPosthogIntegrationProvider, POSTHOG_PROVIDER} from './index.js';

describe('PostHog provider', () => {
  it.each([
    'us',
    'eu',
  ] as const)('has no capabilities or event catalog and links to the %s project', async (region) => {
    const provider = createPosthogIntegrationProvider({
      getPosthogInstallationByConnectionId: async () => ({
        connectionId: 'connection-1',
        region,
        projectId: 'project/1',
        projectName: 'Analytics',
        organizationId: 'organization-1',
        keyHint: '1234',
        credentialVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });

    expect(provider.provider).toBe(POSTHOG_PROVIDER);
    expect(provider.displayName).toBe('PostHog');
    expect('adapters' in provider).toBe(false);
    expect('eventCatalog' in provider).toBe(false);
    expect(await provider.connectionExternalUrl({id: 'connection-1'})).toBe(
      `https://${region}.posthog.com/project/project%2F1`,
    );
  });
});
