import {disconnectSlackInstallation} from './disconnect.js';

vi.mock('#db/installations.js', () => ({
  deleteSlackInstallationByConnectionId: vi.fn(() => Promise.resolve(true)),
}));

const {deleteSlackInstallationByConnectionId} = await import('#db/installations.js');
const deleteSlackInstallationByConnectionIdMock = vi.mocked(deleteSlackInstallationByConnectionId);

describe('disconnectSlackInstallation', () => {
  beforeEach(() => {
    deleteSlackInstallationByConnectionIdMock.mockClear();
    deleteSlackInstallationByConnectionIdMock.mockResolvedValue(true);
  });

  it('deletes stored tokens before deleting connection records', async () => {
    const tx = Symbol('tx');
    const calls: string[] = [];
    const deleteSecrets = vi.fn(() => {
      calls.push('secrets');
      return Promise.resolve(1);
    });
    const deleteConnection = vi.fn(() => {
      calls.push('connection');
      return Promise.resolve(true);
    });

    await disconnectSlackInstallation({
      connectionId: 'connection-1',
      getConnection: vi.fn(() => Promise.resolve({workspaceId: 'workspace-1'})),
      deleteSecrets,
      transaction: async (fn) => await fn(tx),
      deleteConnection,
    });

    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: 'system/integrations/slack/connection-1',
    });
    expect(deleteSlackInstallationByConnectionIdMock).toHaveBeenCalledWith('connection-1', {tx});
    expect(deleteConnection).toHaveBeenCalledWith({connectionId: 'connection-1'}, {tx});
    expect(calls).toEqual(['secrets', 'connection']);
    expect(deleteSecrets.mock.invocationCallOrder[0]).toBeLessThan(
      deleteSlackInstallationByConnectionIdMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(deleteSlackInstallationByConnectionIdMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteConnection.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps connection records when secret deletion fails', async () => {
    const transaction = vi.fn();
    const deleteConnection = vi.fn();

    const run = disconnectSlackInstallation({
      connectionId: 'connection-1',
      getConnection: vi.fn(() => Promise.resolve({workspaceId: 'workspace-1'})),
      deleteSecrets: vi.fn(() => Promise.reject(new Error('secret store unavailable'))),
      transaction,
      deleteConnection,
    });

    await expect(run).rejects.toThrow('secret store unavailable');
    expect(transaction).not.toHaveBeenCalled();
    expect(deleteSlackInstallationByConnectionIdMock).not.toHaveBeenCalled();
    expect(deleteConnection).not.toHaveBeenCalled();
  });

  it('retries idempotent secret deletion after the records transaction fails', async () => {
    const tx = Symbol('tx');
    const deleteSecrets = vi.fn(() => Promise.resolve(0));
    const deleteConnection = vi.fn(() => Promise.resolve(true));
    const transaction = vi
      .fn()
      .mockImplementationOnce(async (fn: (value: symbol) => Promise<unknown>) => {
        await fn(tx);
        throw new Error('database commit failed');
      })
      .mockImplementationOnce(async (fn: (value: symbol) => Promise<unknown>) => await fn(tx));
    const params = {
      connectionId: 'connection-1',
      getConnection: vi.fn(() => Promise.resolve({workspaceId: 'workspace-1'})),
      deleteSecrets,
      transaction,
      deleteConnection,
    };

    const firstAttempt = disconnectSlackInstallation(params);
    await expect(firstAttempt).rejects.toThrow('database commit failed');
    await disconnectSlackInstallation(params);

    expect(deleteSecrets).toHaveBeenCalledTimes(2);
    expect(deleteSlackInstallationByConnectionIdMock).toHaveBeenCalledTimes(2);
    expect(deleteConnection).toHaveBeenCalledTimes(2);
  });
});
