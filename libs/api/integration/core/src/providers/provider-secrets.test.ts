import {scopeProviderSecrets, withSeededSecret} from './provider-secrets.js';

describe('scopeProviderSecrets', () => {
  it('strips the provider prefix before it reaches the secrets', async () => {
    const secrets = {
      getSecret: vi.fn(async () => 'value'),
      setSecrets: vi.fn(async () => undefined),
      deleteSecrets: vi.fn(async () => 1),
    };
    const scoped = scopeProviderSecrets({secrets, provider: 'jam'});
    const scope = {workspaceId: 'workspace-1', namespace: 'system/integrations/jam/connection-1'};

    await scoped.getSecret({...scope, key: 'ACCESS_TOKEN'});
    await scoped.setSecrets({...scope, values: {ACCESS_TOKEN: 'secret'}});
    await scoped.deleteSecrets({...scope, keys: ['ACCESS_TOKEN']});

    expect(secrets.getSecret).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: 'connection-1',
      key: 'ACCESS_TOKEN',
    });
    expect(secrets.setSecrets).toHaveBeenCalledWith(
      expect.objectContaining({namespace: 'connection-1'}),
    );
    expect(secrets.deleteSecrets).toHaveBeenCalledWith(
      expect.objectContaining({namespace: 'connection-1'}),
    );
  });

  it('refuses a namespace outside the provider', () => {
    const secrets = {getSecret: vi.fn(), setSecrets: vi.fn(), deleteSecrets: vi.fn()};
    const scoped = scopeProviderSecrets({secrets, provider: 'jam'});

    expect(() =>
      scoped.getSecret({
        workspaceId: 'workspace-1',
        namespace: 'system/integrations/posthog/connection-1',
        key: 'ACCESS_TOKEN',
      }),
    ).toThrow('unscoped secret namespace');
    expect(secrets.getSecret).not.toHaveBeenCalled();
  });
});

describe('withSeededSecret', () => {
  it('removes the secret when storing it reports failure after persistence', async () => {
    const deleteSecret = vi.fn(async () => 1);
    const createConnection = vi.fn(async () => 'unused');

    await expect(
      withSeededSecret({
        setSecret: () => Promise.reject(new Error('secret write outcome unknown')),
        deleteSecret,
        createConnection,
      }),
    ).rejects.toThrow('secret write outcome unknown');

    expect(deleteSecret).toHaveBeenCalledTimes(1);
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('removes the secret when the connection cannot be created', async () => {
    const failure = new Error('connection creation failed');
    const deleteSecret = vi.fn(async () => 1);

    await expect(
      withSeededSecret({
        setSecret: async () => undefined,
        deleteSecret,
        createConnection: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);

    expect(deleteSecret).toHaveBeenCalledTimes(1);
  });

  it('keeps the secret and returns the connection on success', async () => {
    const deleteSecret = vi.fn(async () => 1);

    const result = await withSeededSecret({
      setSecret: async () => undefined,
      deleteSecret,
      createConnection: async () => 'connection',
    });

    expect(result).toBe('connection');
    expect(deleteSecret).not.toHaveBeenCalled();
  });
});
