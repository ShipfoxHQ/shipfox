import {JiraAccessTokenMissingError, JiraConnectionNotFoundError} from '#core/errors.js';
import {
  createJiraTokenStore,
  type JiraConnectionResolverResult,
  type JiraSecretsStore,
  jiraSecretsNamespace,
} from './tokens.js';

let secrets: JiraSecretsStore;

beforeAll(async () => {
  secrets = await import('@shipfox/api-secrets');
});

function createConnectionContext() {
  const workspaceId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const resolveConnection = vi
    .fn<(connectionId: string) => Promise<JiraConnectionResolverResult | undefined>>()
    .mockResolvedValue({workspaceId});
  const store = createJiraTokenStore({resolveConnection, secrets});

  return {workspaceId, connectionId, resolveConnection, store};
}

function storedToken(input: {
  workspaceId: string;
  connectionId: string;
  key: 'ACCESS_TOKEN' | 'REFRESH_TOKEN';
}) {
  return secrets.getSecret({
    workspaceId: input.workspaceId,
    namespace: jiraSecretsNamespace(input.connectionId),
    key: input.key,
  });
}

describe('createJiraTokenStore.storeTokens', () => {
  it('stores access and refresh tokens in the Jira system namespace', async () => {
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
    const {connectionId, resolveConnection, store} = createConnectionContext();
    resolveConnection.mockResolvedValue(undefined);

    const result = store.storeTokens({connectionId, accessToken: 'access-token'});

    await expect(result).rejects.toBeInstanceOf(JiraConnectionNotFoundError);
  });
});

describe('createJiraTokenStore.getAccessToken', () => {
  it('returns the stored access token', async () => {
    const {connectionId, store} = createConnectionContext();
    await store.storeTokens({connectionId, accessToken: 'access-token'});

    const result = await store.getAccessToken({connectionId});

    expect(result).toBe('access-token');
  });

  it('throws a typed error when no access token is stored', async () => {
    const {connectionId, store} = createConnectionContext();

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toBeInstanceOf(JiraAccessTokenMissingError);
  });

  it('throws a typed error when the connection cannot be resolved', async () => {
    const {connectionId, resolveConnection, store} = createConnectionContext();
    resolveConnection.mockResolvedValue(undefined);

    const result = store.getAccessToken({connectionId});

    await expect(result).rejects.toBeInstanceOf(JiraConnectionNotFoundError);
  });
});
