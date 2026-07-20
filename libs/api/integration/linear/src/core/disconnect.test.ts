import {disconnectLinearInstallation} from './disconnect.js';

vi.mock('#db/installations.js', () => ({
  deleteLinearInstallationByConnectionId: vi.fn(() => Promise.resolve(true)),
}));

const {deleteLinearInstallationByConnectionId} = await import('#db/installations.js');
const deleteLinearInstallationByConnectionIdMock = vi.mocked(
  deleteLinearInstallationByConnectionId,
);

describe('disconnectLinearInstallation', () => {
  beforeEach(() => {
    deleteLinearInstallationByConnectionIdMock.mockClear();
    deleteLinearInstallationByConnectionIdMock.mockResolvedValue(true);
  });

  it('deletes stored tokens before deleting connection records', async () => {
    const tx = Symbol('tx');
    const calls: string[] = [];
    const deleteSecrets = vi.fn(() => {
      calls.push('secrets');
      return Promise.resolve(2);
    });
    const deleteConnection = vi.fn(() => {
      calls.push('connection');
      return Promise.resolve(true);
    });

    await disconnectLinearInstallation({
      connectionId: 'connection-1',
      getConnection: vi.fn(() => Promise.resolve({workspaceId: 'workspace-1'})),
      deleteSecrets,
      transaction: async (fn) => await fn(tx),
      deleteConnection,
    });

    expect(deleteSecrets).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      namespace: 'system/integrations/linear/connection-1',
    });
    expect(deleteLinearInstallationByConnectionIdMock).toHaveBeenCalledWith('connection-1', {tx});
    expect(deleteConnection).toHaveBeenCalledWith({connectionId: 'connection-1'}, {tx});
    expect(calls).toEqual(['secrets', 'connection']);
  });

  it('keeps connection records when secret deletion fails', async () => {
    const transaction = vi.fn();
    const deleteConnection = vi.fn();

    const run = disconnectLinearInstallation({
      connectionId: 'connection-1',
      getConnection: vi.fn(() => Promise.resolve({workspaceId: 'workspace-1'})),
      deleteSecrets: vi.fn(() => Promise.reject(new Error('secret store unavailable'))),
      transaction,
      deleteConnection,
    });

    await expect(run).rejects.toThrow('secret store unavailable');
    expect(transaction).not.toHaveBeenCalled();
    expect(deleteLinearInstallationByConnectionIdMock).not.toHaveBeenCalled();
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

    const firstAttempt = disconnectLinearInstallation(params);
    await expect(firstAttempt).rejects.toThrow('database commit failed');
    await disconnectLinearInstallation(params);

    expect(deleteSecrets).toHaveBeenCalledTimes(2);
    expect(deleteLinearInstallationByConnectionIdMock).toHaveBeenCalledTimes(2);
    expect(deleteConnection).toHaveBeenCalledTimes(2);
  });
});
