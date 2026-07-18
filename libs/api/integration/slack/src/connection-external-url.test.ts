import type {SlackInstallation} from '#db/installations.js';
import {createSlackIntegrationProvider} from '#index.js';

describe('Slack connectionExternalUrl', () => {
  it('resolves the Slack team URL from the installation row', async () => {
    const provider = createSlackIntegrationProvider({
      getSlackInstallationByConnectionId: () =>
        Promise.resolve({teamId: 'T 123'} as SlackInstallation),
    });

    const result = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(result).toBe('https://app.slack.com/client/T%20123');
  });

  it('returns undefined when the installation is missing', async () => {
    const provider = createSlackIntegrationProvider({
      getSlackInstallationByConnectionId: () => Promise.resolve(undefined),
    });

    const result = await provider.connectionExternalUrl({id: crypto.randomUUID()});

    expect(result).toBeUndefined();
  });
});
