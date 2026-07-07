import {getLinearInstallationByConnectionId, upsertLinearInstallation} from '#db/installations.js';
import {
  LinearAccessTokenMissingError,
  LinearConnectionNotFoundError,
  LinearTokenUnrefreshableError,
} from './errors.js';
import {
  createLinearTokenStore,
  type LinearConnectionResolverResult,
  type LinearSecretsStore,
  linearSecretsNamespace,
} from './tokens.js';

let secrets: LinearSecretsStore;

beforeAll(async () => {
  // @ts-expect-error @shipfox/api-secrets is a peer supplied by the composing API app.
  secrets = await import('@shipfox/api-secrets');
});

function createConnectionContext() {
  const workspaceId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const resolveConnection = vi
    .fn<(connectionId: string) => Promise<LinearConnectionResolverResult | undefined>>()
    .mockResolvedValue({workspaceId});
  const refreshAccessToken = vi.fn();
  const store = createLinearTokenStore({
    resolveConnection,
    secrets,
    client: {
      exchangeAuthorizationCode: vi.fn(),
      getIdentity: vi.fn(),
      refreshAccessToken,
    },
  });

  return {workspaceId, connectionId, resolveConnection, refreshAccessToken, store};
}

function createInstallation(input: {
  connectionId: string;
  tokenExpiresAt?: Date | null | undefined;
  scopes?: string[] | undefined;
}) {
  return upsertLinearInstallation({
    connectionId: input.connectionId,
    organizationId: `org-${crypto.randomUUID()}`,
    organizationUrlKey: 'acme',
    appUserId: 'app-user-id',
    scopes: input.scopes ?? ['read'],
    tokenExpiresAt: input.tokenExpiresAt,
    status: 'installed',
  });
}

function storedToken(input: {
  workspaceId: string;
  connectionId: string;
  key: 'ACCESS_TOKEN' | 'REFRESH_TOKEN';
}) {
  return secrets.getSecret({
    workspaceId: input.workspaceId,
    namespace: linearSecretsNamespace(input.connectionId),
    key: input.key,
  });
}

describe('createLinearTokenStore.storeTokens', () => {
  it('stores access and refresh tokens in the Linear system namespace', async () => {
    const {workspaceId, connectionId, store} = createConnectionContext();

    await store.storeTokens({
      connectionId,
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      editedBy: crypto.randomUUID(),
    });

    await expect(storedToken({workspaceId, connectionId, key: 'ACCESS_TOKEN'})).resolves.toBe(
      'access-token',
    );
    await expect(storedToken({workspaceId, connectionId, key: 'REFRESH_TOKEN'})).resolves.toBe(
      'refresh-token',
    );
  });

  it('stores only the access token when no refresh token was issued', async () => {
    const {workspaceId, connectionId, store} = createConnectionContext();

    await store.storeTokens({connectionId, accessToken: 'access-token'});

    await expect(storedToken({workspaceId, connectionId, key: 'ACCESS_TOKEN'})).resolves.toBe(
      'access-token',
    );
    await expect(
      storedToken({workspaceId, connectionId, key: 'REFRESH_TOKEN'}),
    ).resolves.toBeNull();
  });

  it('throws a typed error when the connection cannot be resolved', async () => {
    const {store, resolveConnection, connectionId} = createConnectionContext();
    resolveConnection.mockResolvedValue(undefined);

    const result = store.storeTokens({connectionId, accessToken: 'access-token'});

    await expect(result).rejects.toBeInstanceOf(LinearConnectionNotFoundError);
  });
});

describe('createLinearTokenStore.getAccessToken', () => {
  it('returns the stored token when no refresh is needed', async () => {
    const {connectionId, refreshAccessToken, store} = createConnectionContext();
    await store.storeTokens({connectionId, accessToken: 'access-token'});
    await createInstallation({
      connectionId,
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const result = await store.getAccessToken({connectionId});

    expect(result).toBe('access-token');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and writes the new secret and metadata', async () => {
    const {workspaceId, connectionId, refreshAccessToken, store} = createConnectionContext();
    const expiresAt = new Date('2026-07-07T13:00:00.000Z');
    await store.storeTokens({
      connectionId,
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
    });
    await createInstallation({
      connectionId,
      tokenExpiresAt: new Date('2026-07-07T11:00:00.000Z'),
      scopes: ['read'],
    });
    refreshAccessToken.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt,
      scopes: ['read', 'write'],
    });

    const result = await store.getAccessToken({connectionId});

    const installation = await getLinearInstallationByConnectionId(connectionId);
    expect(result).toBe('new-access-token');
    await expect(storedToken({workspaceId, connectionId, key: 'ACCESS_TOKEN'})).resolves.toBe(
      'new-access-token',
    );
    await expect(storedToken({workspaceId, connectionId, key: 'REFRESH_TOKEN'})).resolves.toBe(
      'new-refresh-token',
    );
    expect(installation?.tokenExpiresAt?.toISOString()).toBe(expiresAt.toISOString());
    expect(installation?.scopes).toEqual(['read', 'write']);
  });

  it('force refreshes even when the token expiry is unknown', async () => {
    const {connectionId, refreshAccessToken, store} = createConnectionContext();
    await store.storeTokens({
      connectionId,
      accessToken: 'old-access-token',
      refreshToken: 'refresh-token',
    });
    await createInstallation({connectionId, tokenExpiresAt: null});
    refreshAccessToken.mockResolvedValue({
      accessToken: 'new-access-token',
      expiresAt: new Date('2026-07-07T13:00:00.000Z'),
      scopes: [],
    });

    const result = await store.getAccessToken({connectionId, forceRefresh: true});

    expect(result).toBe('new-access-token');
  });

  it('returns the stored token for proactive refresh when no refresh token exists', async () => {
    const {connectionId, refreshAccessToken, store} = createConnectionContext();
    await store.storeTokens({connectionId, accessToken: 'access-token'});
    await createInstallation({
      connectionId,
      tokenExpiresAt: new Date('2026-07-07T11:00:00.000Z'),
    });

    const result = await store.getAccessToken({connectionId});

    expect(result).toBe('access-token');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('preserves the stored refresh token when Linear omits a rotated replacement', async () => {
    const {workspaceId, connectionId, refreshAccessToken, store} = createConnectionContext();
    await store.storeTokens({
      connectionId,
      accessToken: 'old-access-token',
      refreshToken: 'old-refresh-token',
    });
    await createInstallation({
      connectionId,
      tokenExpiresAt: new Date('2026-07-07T11:00:00.000Z'),
    });
    refreshAccessToken.mockResolvedValue({
      accessToken: 'new-access-token',
      expiresAt: new Date('2026-07-07T13:00:00.000Z'),
      scopes: ['read'],
    });

    await store.getAccessToken({connectionId});

    await expect(storedToken({workspaceId, connectionId, key: 'REFRESH_TOKEN'})).resolves.toBe(
      'old-refresh-token',
    );
  });

  it('shares one in-process refresh across concurrent callers', async () => {
    const {connectionId, refreshAccessToken, store} = createConnectionContext();
    await store.storeTokens({
      connectionId,
      accessToken: 'old-access-token',
      refreshToken: 'refresh-token',
    });
    await createInstallation({
      connectionId,
      tokenExpiresAt: new Date('2026-07-07T11:00:00.000Z'),
    });
    refreshAccessToken.mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
      expiresAt: new Date('2026-07-07T13:00:00.000Z'),
      scopes: ['read'],
    });

    const results = await Promise.all([
      store.getAccessToken({connectionId}),
      store.getAccessToken({connectionId}),
    ]);

    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['new-access-token', 'new-access-token']);
  });

  it('throws reconnect-needed when a forced refresh has no refresh token', async () => {
    const {connectionId, store} = createConnectionContext();
    await store.storeTokens({connectionId, accessToken: 'dead-access-token'});
    await createInstallation({connectionId, tokenExpiresAt: null});

    const result = store.getAccessToken({connectionId, forceRefresh: true});

    await expect(result).rejects.toBeInstanceOf(LinearTokenUnrefreshableError);
  });

  it('throws a typed error when the connection cannot be resolved', async () => {
    const {store, resolveConnection, connectionId} = createConnectionContext();
    resolveConnection.mockResolvedValue(undefined);

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toBeInstanceOf(LinearConnectionNotFoundError);
  });

  it('throws a typed error when no access token is stored', async () => {
    const {connectionId, store} = createConnectionContext();
    await createInstallation({connectionId, tokenExpiresAt: null});

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toBeInstanceOf(LinearAccessTokenMissingError);
  });

  it('skips proactive refresh when the installation row is missing', async () => {
    const {connectionId, refreshAccessToken, store} = createConnectionContext();
    await store.storeTokens({connectionId, accessToken: 'access-token'});

    const result = await store.getAccessToken({connectionId});

    expect(result).toBe('access-token');
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});
