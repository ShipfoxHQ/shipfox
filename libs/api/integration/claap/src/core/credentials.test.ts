import {claapSecretsNamespace, createClaapCredentialStore} from './credentials.js';

describe('Claap credential store', () => {
  it('uses the connection namespace and API_KEY secret name', async () => {
    const calls: string[] = [];
    const values = new Map<string, string>();
    const store = createClaapCredentialStore({
      resolveConnection: async () => ({workspaceId: 'workspace-1'}),
      secrets: {
        getSecret: ({namespace, key}) => {
          calls.push(`get:${namespace}:${key}`);
          return Promise.resolve(values.get(namespace) ?? null);
        },
        setSecrets: ({namespace, values: nextValues}) => {
          calls.push(`set:${namespace}`);
          values.set(namespace, nextValues.API_KEY ?? '');
          return Promise.resolve();
        },
        deleteSecrets: ({namespace, keys}) => {
          calls.push(`delete:${namespace}:${keys?.join(',')}`);
          values.delete(namespace);
          return Promise.resolve(1);
        },
      },
    });

    await store.setApiKey({connectionId: 'connection-1', apiKey: 'cla_secret'});
    expect(await store.getApiKey('connection-1')).toBe('cla_secret');
    await store.deleteApiKey('connection-1');

    expect(calls).toEqual([
      'set:system/integrations/claap/connection-1',
      'get:system/integrations/claap/connection-1:API_KEY',
      'delete:system/integrations/claap/connection-1:API_KEY',
    ]);
    expect(claapSecretsNamespace('connection-1')).toBe('system/integrations/claap/connection-1');
  });
});
