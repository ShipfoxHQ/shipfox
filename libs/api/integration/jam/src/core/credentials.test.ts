import {createJamCredentialStore, jamSecretsNamespace} from './credentials.js';

describe('Jam credential store', () => {
  it('uses the connection namespace and ACCESS_TOKEN secret name', async () => {
    const calls: string[] = [];
    const values = new Map<string, string>();
    const store = createJamCredentialStore({
      resolveConnection: async () => ({workspaceId: 'workspace-1'}),
      secrets: {
        getSecret: ({namespace, key}) => {
          calls.push(`get:${namespace}:${key}`);
          return Promise.resolve(values.get(namespace) ?? null);
        },
        setSecrets: ({namespace, values: nextValues}) => {
          calls.push(`set:${namespace}`);
          values.set(namespace, nextValues.ACCESS_TOKEN ?? '');
          return Promise.resolve();
        },
        deleteSecrets: ({namespace, keys}) => {
          calls.push(`delete:${namespace}:${keys?.join(',')}`);
          values.delete(namespace);
          return Promise.resolve(1);
        },
      },
    });

    await store.setToken({connectionId: 'connection-1', token: 'jam_pat_secret'});
    expect(await store.getToken('connection-1')).toBe('jam_pat_secret');
    await store.deleteToken('connection-1');

    expect(calls).toEqual([
      'set:system/integrations/jam/connection-1',
      'get:system/integrations/jam/connection-1:ACCESS_TOKEN',
      'delete:system/integrations/jam/connection-1:ACCESS_TOKEN',
    ]);
    expect(jamSecretsNamespace('connection-1')).toBe('system/integrations/jam/connection-1');
  });
});
