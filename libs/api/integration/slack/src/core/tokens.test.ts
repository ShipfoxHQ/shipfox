import {SlackBotTokenMissingError, SlackConnectionNotFoundError} from '#core/errors.js';
import {upsertSlackInstallation} from '#db/installations.js';
import {
  createSlackTokenStore,
  type SlackConnectionResolverResult,
  type SlackSecretsStore,
  slackSecretsNamespace,
} from './tokens.js';

let slackSecrets: SlackSecretsStore;

beforeAll(async () => {
  slackSecrets = await import('@shipfox/api-secrets');
});

function createConnectionContext() {
  const workspaceId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const resolveConnection = vi
    .fn<(connectionId: string) => Promise<SlackConnectionResolverResult | undefined>>()
    .mockResolvedValue({workspaceId});
  const getSecret = vi.fn<SlackSecretsStore['getSecret']>((params) =>
    slackSecrets.getSecret(params),
  );
  const secrets = {getSecret, setSecrets: slackSecrets.setSecrets};
  const store = createSlackTokenStore({resolveConnection, secrets});

  return {workspaceId, connectionId, getSecret, resolveConnection, store};
}

async function arrangeSlackInstallation({
  connectionId,
  status = 'installed',
  tokenExpiresAt = null,
}: {
  connectionId: string;
  status?: 'installed' | 'revoked';
  tokenExpiresAt?: Date | null;
}): Promise<void> {
  await upsertSlackInstallation({
    connectionId,
    teamId: `T${crypto.randomUUID()}`,
    teamName: 'Acme',
    appId: 'A123',
    botUserId: 'U123',
    scopes: ['app_mentions:read'],
    status,
    tokenExpiresAt,
  });
}

describe('createSlackTokenStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and reads a bot token in the Slack system namespace', async () => {
    const {workspaceId, connectionId, store} = createConnectionContext();

    await store.storeTokens({
      connectionId,
      botToken: 'xoxb-test-token',
      editedBy: crypto.randomUUID(),
    });
    await arrangeSlackInstallation({connectionId});

    const result = await store.getAccessToken({connectionId});

    await expect(
      slackSecrets.getSecret({
        workspaceId,
        namespace: slackSecretsNamespace(connectionId),
        key: 'BOT_TOKEN',
      }),
    ).resolves.toBe('xoxb-test-token');
    expect(result).toBe('xoxb-test-token');
  });

  it('reads an installed bot token with a future expiry', async () => {
    const {connectionId, store} = createConnectionContext();
    await store.storeTokens({connectionId, botToken: 'xoxb-test-token'});
    await arrangeSlackInstallation({
      connectionId,
      tokenExpiresAt: new Date(Date.now() + 60_000),
    });

    const result = await store.getAccessToken({connectionId});

    expect(result).toBe('xoxb-test-token');
  });

  it('rejects a token whose expiry is exactly now', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-07-18T15:00:00.000Z');
    vi.setSystemTime(now);
    const {connectionId, getSecret, store} = createConnectionContext();
    await arrangeSlackInstallation({connectionId, tokenExpiresAt: now});

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toMatchObject({
      reason: 'expired',
      expiresAt: now,
    });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('rejects a token whose expiry is in the past', async () => {
    const {connectionId, getSecret, store} = createConnectionContext();
    await arrangeSlackInstallation({
      connectionId,
      tokenExpiresAt: new Date(Date.now() - 60_000),
    });

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toMatchObject({
      reason: 'expired',
    });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('rejects a revoked installation before reading the bot token', async () => {
    const {connectionId, getSecret, store} = createConnectionContext();
    await arrangeSlackInstallation({connectionId, status: 'revoked'});

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toMatchObject({
      reason: 'not-installed',
    });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('rejects a missing installation before reading the bot token', async () => {
    const {connectionId, getSecret, store} = createConnectionContext();

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toMatchObject({
      reason: 'installation-not-found',
    });
    expect(getSecret).not.toHaveBeenCalled();
  });

  it('throws a typed error when the bot token is missing', async () => {
    const {connectionId, store} = createConnectionContext();
    await arrangeSlackInstallation({connectionId});

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
