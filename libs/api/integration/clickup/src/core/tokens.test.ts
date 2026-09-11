import {ClickUpAccessTokenMissingError, ClickUpConnectionNotFoundError} from './errors.js';
import {
  type ClickUpConnectionResolverResult,
  type ClickUpSecretsStore,
  clickupSecretsNamespace,
  createClickUpTokenStore,
} from './tokens.js';

function createSecretsStore() {
  const values = new Map<string, string>();
  const key = (params: {workspaceId: string; namespace: string; key: string}) =>
    `${params.workspaceId}\0${params.namespace}\0${params.key}`;
  const secrets: ClickUpSecretsStore = {
    getSecret: vi.fn(async (params) => values.get(key(params)) ?? null),
    setSecrets: vi.fn((params) => {
      for (const secretKey of Object.keys(params.values)) {
        values.set(key({...params, key: secretKey}), params.values[secretKey] as string);
      }
      return Promise.resolve();
    }),
  };
  return secrets;
}

function createContext() {
  const workspaceId = crypto.randomUUID();
  const connectionId = crypto.randomUUID();
  const resolveConnection = vi
    .fn<(id: string) => Promise<ClickUpConnectionResolverResult | undefined>>()
    .mockResolvedValue({workspaceId});
  const secrets = createSecretsStore();
  const store = createClickUpTokenStore({resolveConnection, secrets});
  return {workspaceId, connectionId, resolveConnection, secrets, store};
}

describe('ClickUp token store', () => {
  it('stores both credentials in the scoped namespace and reads the access token', async () => {
    const {workspaceId, connectionId, secrets, store} = createContext();

    await store.storeTokens({
      connectionId,
      accessToken: 'access-token',
      webhookSecret: 'webhook-secret',
    });

    expect(secrets.setSecrets).toHaveBeenCalledWith({
      workspaceId,
      namespace: clickupSecretsNamespace(connectionId),
      values: {ACCESS_TOKEN: 'access-token', WEBHOOK_SECRET: 'webhook-secret'},
      editedBy: undefined,
    });
    await expect(store.getAccessToken({connectionId})).resolves.toBe('access-token');
    await expect(store.getWebhookSecret({connectionId})).resolves.toBe('webhook-secret');
  });

  it('rejects missing connections and access tokens', async () => {
    const {connectionId, resolveConnection, store} = createContext();
    resolveConnection.mockResolvedValueOnce(undefined);

    await expect(store.getAccessToken({connectionId})).rejects.toBeInstanceOf(
      ClickUpConnectionNotFoundError,
    );
    await expect(store.getAccessToken({connectionId})).rejects.toBeInstanceOf(
      ClickUpAccessTokenMissingError,
    );
  });
});
