import {NotionAccessTokenMissingError, NotionConnectionNotFoundError} from './errors.js';
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
  const store = createNotionTokenStore({resolveConnection, secrets});
  return {workspaceId, connectionId, resolveConnection, secrets, store};
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
    await expect(store.getAccessToken({connectionId, forceRefresh: true})).resolves.toBe(
      'access-token',
    );
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
});
