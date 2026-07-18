import {SlackBotTokenMissingError, SlackConnectionNotFoundError} from '#core/errors.js';
import {
  createSlackTokenStore,
  type SlackConnectionResolverResult,
  type SlackSecretsStore,
  slackSecretsNamespace,
} from './tokens.js';

let secrets: SlackSecretsStore;

beforeAll(async () => {
  secrets = await import('@shipfox/api-secrets');
});

function createConnectionContext() {
  const workspaceId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const resolveConnection = vi
    .fn<(connectionId: string) => Promise<SlackConnectionResolverResult | undefined>>()
    .mockResolvedValue({workspaceId});
  const store = createSlackTokenStore({resolveConnection, secrets});

  return {workspaceId, connectionId, resolveConnection, store};
}

describe('createSlackTokenStore', () => {
  it('stores and reads a bot token in the Slack system namespace', async () => {
    const {workspaceId, connectionId, store} = createConnectionContext();

    await store.storeTokens({
      connectionId,
      botToken: 'xoxb-test-token',
      editedBy: crypto.randomUUID(),
    });
    const result = await store.getAccessToken({connectionId});

    await expect(
      secrets.getSecret({
        workspaceId,
        namespace: slackSecretsNamespace(connectionId),
        key: 'BOT_TOKEN',
      }),
    ).resolves.toBe('xoxb-test-token');
    expect(result).toBe('xoxb-test-token');
  });

  it('throws a typed error when the bot token is missing', async () => {
    const {connectionId, store} = createConnectionContext();

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toBeInstanceOf(SlackBotTokenMissingError);
  });

  it('throws a typed error when the connection cannot be resolved', async () => {
    const {connectionId, resolveConnection, store} = createConnectionContext();
    resolveConnection.mockResolvedValue(undefined);

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toBeInstanceOf(SlackConnectionNotFoundError);
  });
});
