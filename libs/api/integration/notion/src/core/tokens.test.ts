import {upsertNotionInstallation} from '#db/installations.js';
import {
  NotionAccessTokenMissingError,
  NotionConnectionNotFoundError,
  NotionIntegrationProviderError,
} from './errors.js';
import {
  createNotionTokenStore,
  type NotionConnectionResolverResult,
  type NotionSecretsStore,
  notionSecretsNamespace,
} from './tokens.js';

function createSecretsStore() {
  const values = new Map<string, string>();
  const key = (params: {workspaceId: string; namespace: string; key: string}) =>
    `${params.workspaceId}\0${params.namespace}\0${params.key}`;
  const secrets: NotionSecretsStore = {
    getSecret: vi.fn(async (params) => values.get(key(params)) ?? null),
    setSecrets: vi.fn((params) => {
      for (const secretKey of Object.keys(params.values)) {
        values.set(key({...params, key: secretKey}), params.values[secretKey] as string);
      }
      return Promise.resolve();
    }),
    deleteSecrets: vi.fn((params) => {
      let deleted = 0;
      for (const secretKey of ['ACCESS_TOKEN', 'REFRESH_TOKEN']) {
        if (values.delete(key({...params, key: secretKey}))) deleted += 1;
      }
      return Promise.resolve(deleted);
    }),
  };
  return secrets;
}

function createContext() {
  const workspaceId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const resolveConnection = vi
    .fn<(id: string) => Promise<NotionConnectionResolverResult | undefined>>()
    .mockResolvedValue({workspaceId});
  const secrets = createSecretsStore();
  const client = {
    refreshAccessToken: vi.fn(),
    revokeToken: vi.fn(),
  };
  const store = createNotionTokenStore({resolveConnection, secrets, client});
  return {client, workspaceId, connectionId, resolveConnection, secrets, store};
}

describe('Notion token store', () => {
  it('stores and reads credentials in the scoped namespace', async () => {
    const {workspaceId, connectionId, secrets, store} = createContext();

    await store.storeTokens({
      connectionId,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    expect(secrets.setSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace: notionSecretsNamespace(connectionId),
      values: {ACCESS_TOKEN: 'access-token', REFRESH_TOKEN: 'refresh-token'},
      editedBy: undefined,
    });
    await expect(store.getAccessToken({connectionId})).resolves.toBe('access-token');
  });

  it('deletes credentials through the same scoped namespace', async () => {
    const {workspaceId, connectionId, secrets, store} = createContext();
    await store.storeTokens({connectionId, accessToken: 'access-token'});

    await expect(store.deleteTokens({connectionId})).resolves.toBe(1);
    expect(secrets.deleteSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace: notionSecretsNamespace(connectionId),
    });
  });

  it('rejects missing connections and access tokens', async () => {
    const {connectionId, resolveConnection, store} = createContext();
    resolveConnection.mockResolvedValueOnce(undefined);

    await expect(store.getAccessToken({connectionId})).rejects.toBeInstanceOf(
      NotionConnectionNotFoundError,
    );
    await expect(store.getAccessToken({connectionId})).rejects.toBeInstanceOf(
      NotionAccessTokenMissingError,
    );
  });

  it('refreshes ahead of a known expiry and persists the rotated pair', async () => {
    const {client, connectionId, secrets, store, workspaceId} = createContext();
    await store.storeTokens({
      connectionId,
      accessToken: 'access-token-0',
      refreshToken: 'refresh-token-0',
    });
    await upsertNotionInstallation({
      connectionId,
      notionWorkspaceId: crypto.randomUUID(),
      workspaceName: 'Acme',
      botId: crypto.randomUUID(),
      authorizedByUserId: crypto.randomUUID(),
      tokenExpiresAt: new Date(Date.now() + 4 * 60 * 1000),
      status: 'installed',
    });
    client.refreshAccessToken.mockResolvedValue({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
    });

    const result = await store.getAccessToken({connectionId});

    expect(result).toBe('access-token-1');
    expect(client.refreshAccessToken).toHaveBeenCalledWith({refreshToken: 'refresh-token-0'});
    expect(
      await secrets.getSecret({
        workspaceId,
        namespace: notionSecretsNamespace(connectionId),
        key: 'REFRESH_TOKEN',
      }),
    ).toBe('refresh-token-1');
  });

  it('force refreshes a token without a known expiry', async () => {
    const {client, connectionId, store} = createContext();
    await store.storeTokens({
      connectionId,
      accessToken: 'access-token-0',
      refreshToken: 'refresh-token-0',
    });
    client.refreshAccessToken.mockResolvedValue({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
    });

    await expect(store.getAccessToken({connectionId, forceRefresh: true})).resolves.toBe(
      'access-token-1',
    );
  });

  it('marks the connection as errored when Notion rejects the refresh grant', async () => {
    const markConnectionError = vi.fn().mockResolvedValue(undefined);
    const {client, connectionId, resolveConnection, secrets} = createContext();
    const store = createNotionTokenStore({
      client,
      resolveConnection,
      secrets,
      markConnectionError,
    });
    await store.storeTokens({
      connectionId,
      accessToken: 'access-token-0',
      refreshToken: 'refresh-token-0',
    });
    const error = new NotionIntegrationProviderError(
      'access-denied',
      'Notion rejected the refresh grant',
      'invalid_grant',
    );
    client.refreshAccessToken.mockRejectedValue(error);

    await expect(store.getAccessToken({connectionId, forceRefresh: true})).rejects.toBe(error);
    expect(markConnectionError).toHaveBeenCalledWith({connectionId});
  });

  it('deduplicates concurrent refreshes within one process', async () => {
    const {client, connectionId, store} = createContext();
    await store.storeTokens({
      connectionId,
      accessToken: 'access-token-0',
      refreshToken: 'refresh-token-0',
    });
    let resolveRefresh!: (value: {accessToken: string; refreshToken: string}) => void;
    client.refreshAccessToken.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const first = store.getAccessToken({connectionId, forceRefresh: true});
    const second = store.getAccessToken({connectionId, forceRefresh: true});
    await vi.waitFor(() => expect(client.refreshAccessToken).toHaveBeenCalledOnce());

    resolveRefresh({accessToken: 'access-token-1', refreshToken: 'refresh-token-1'});
    await expect(Promise.all([first, second])).resolves.toEqual([
      'access-token-1',
      'access-token-1',
    ]);
  });

  it('lets a second replica wait for the winner and return its rotated token', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const secrets = createSecretsStore();
    const resolveConnection = vi.fn().mockResolvedValue({workspaceId});
    const firstClient = {refreshAccessToken: vi.fn(), revokeToken: vi.fn()};
    const secondClient = {refreshAccessToken: vi.fn(), revokeToken: vi.fn()};
    const first = createNotionTokenStore({resolveConnection, secrets, client: firstClient});
    const second = createNotionTokenStore({resolveConnection, secrets, client: secondClient});
    await first.storeTokens({
      connectionId,
      accessToken: 'access-token-0',
      refreshToken: 'refresh-token-0',
    });
    let resolveRefresh!: (value: {accessToken: string; refreshToken: string}) => void;
    firstClient.refreshAccessToken.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const winner = first.getAccessToken({connectionId, forceRefresh: true});
    await vi.waitFor(() => expect(firstClient.refreshAccessToken).toHaveBeenCalledOnce());
    const loser = second.getAccessToken({connectionId, forceRefresh: true});
    await vi.waitFor(() =>
      expect(vi.mocked(secrets.getSecret).mock.calls.length).toBeGreaterThanOrEqual(4),
    );

    resolveRefresh({accessToken: 'access-token-1', refreshToken: 'refresh-token-1'});
    await expect(winner).resolves.toBe('access-token-1');
    await expect(loser).resolves.toBe('access-token-1');
    expect(secondClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it('times out when the other replica never changes the stored token', async () => {
    const {connectionId, secrets, store} = createContext();
    await store.storeTokens({
      connectionId,
      accessToken: 'access-token-0',
      refreshToken: 'refresh-token-0',
    });
    let releaseLock!: () => void;
    let markLockStarted!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockStarted = new Promise<void>((resolve) => {
      markLockStarted = resolve;
    });
    const lock = (await import('#db/installations.js')).tryWithNotionGrantLock(connectionId, () => {
      markLockStarted();
      return lockHeld;
    });
    await lockStarted;

    vi.useFakeTimers();
    try {
      const loser = store.getAccessToken({connectionId, forceRefresh: true});
      const loserFailure = expect(loser).rejects.toMatchObject({reason: 'provider-unavailable'});
      await vi.waitFor(() => expect(secrets.getSecret).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(5_000);
      await loserFailure;
    } finally {
      releaseLock();
      await lock;
      vi.useRealTimers();
    }
  });
});
