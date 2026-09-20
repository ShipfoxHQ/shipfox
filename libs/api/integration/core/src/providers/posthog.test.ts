import {withPosthogSeedCredential} from './posthog.js';

describe('PostHog seed credentials', () => {
  it('cleans up when storing a new secret reports failure after persistence', async () => {
    const storedConnectionIds = new Set<string>();
    const credentialStore = {
      setApiKey: vi.fn(({connectionId}: {connectionId: string}) => {
        storedConnectionIds.add(connectionId);
        return Promise.reject(new Error('secret write outcome unknown'));
      }),
      deleteApiKey: vi.fn(({connectionId}: {connectionId: string}) =>
        Promise.resolve(Number(storedConnectionIds.delete(connectionId))),
      ),
    };
    const createConnection = vi.fn(() => Promise.resolve('unused'));

    await expect(
      withPosthogSeedCredential({
        credentialStore,
        connectionId: '00000000-0000-4000-8000-000000000001',
        workspaceId: '00000000-0000-4000-8000-000000000002',
        apiKey: 'phx_secret',
        createConnection,
      }),
    ).rejects.toThrow('secret write outcome unknown');

    expect(storedConnectionIds.size).toBe(0);
    expect(credentialStore.deleteApiKey).toHaveBeenCalledWith({
      connectionId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
    });
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('cleans up when connection creation reports failure after storing a secret', async () => {
    const storedConnectionIds = new Set<string>();
    const connectionCreationError = new Error('connection creation failed');
    const credentialStore = {
      setApiKey: vi.fn(({connectionId}: {connectionId: string}) => {
        storedConnectionIds.add(connectionId);
        return Promise.resolve();
      }),
      deleteApiKey: vi.fn(({connectionId}: {connectionId: string}) =>
        Promise.resolve(Number(storedConnectionIds.delete(connectionId))),
      ),
    };
    const createConnection = vi.fn(() => Promise.reject(connectionCreationError));

    const result = withPosthogSeedCredential({
      credentialStore,
      connectionId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      apiKey: 'phx_secret',
      createConnection,
    });

    await expect(result).rejects.toBe(connectionCreationError);

    expect(createConnection).toHaveBeenCalledTimes(1);
    expect(storedConnectionIds.size).toBe(0);
    expect(credentialStore.deleteApiKey).toHaveBeenCalledTimes(1);
    expect(credentialStore.deleteApiKey).toHaveBeenCalledWith({
      connectionId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
    });
  });
});
