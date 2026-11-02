import {SLACK_BOT_SCOPES} from '#core/scopes.js';
import type {SlackInstallation} from '#db/installations.js';
import {createSlackIntegrationProvider} from '#index.js';

function providerWithInstallation(installation: Partial<SlackInstallation> | undefined) {
  return createSlackIntegrationProvider({
    getSlackInstallationByConnectionId: () =>
      Promise.resolve(installation as SlackInstallation | undefined),
  });
}

describe('Slack connectionReconnectRequired', () => {
  it('asks an installation that predates the agent scopes to reconnect', async () => {
    const provider = providerWithInstallation({
      status: 'installed',
      scopes: SLACK_BOT_SCOPES.filter((scope) => scope !== 'assistant:write'),
    });

    const result = await provider.connectionReconnectRequired({id: crypto.randomUUID()});

    expect(result).toBe(true);
  });

  it('accepts an installation with every required scope', async () => {
    const provider = providerWithInstallation({status: 'installed', scopes: [...SLACK_BOT_SCOPES]});

    const result = await provider.connectionReconnectRequired({id: crypto.randomUUID()});

    expect(result).toBe(false);
  });

  it.each([
    {name: 'a missing installation', installation: undefined},
    {name: 'a revoked installation', installation: {status: 'revoked' as const, scopes: []}},
  ])('does not ask $name to reconnect', async ({installation}) => {
    const provider = providerWithInstallation(installation);

    const result = await provider.connectionReconnectRequired({id: crypto.randomUUID()});

    expect(result).toBe(false);
  });
});
