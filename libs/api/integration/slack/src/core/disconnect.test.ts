import {disconnectSlackInstallation} from './disconnect.js';

vi.mock('#db/installations.js', () => ({
  deleteSlackInstallationByConnectionId: vi.fn(() => Promise.resolve(true)),
}));

const {deleteSlackInstallationByConnectionId} = await import('#db/installations.js');
const deleteSlackInstallationByConnectionIdMock = vi.mocked(deleteSlackInstallationByConnectionId);

describe('disconnectSlackInstallation', () => {
  beforeEach(() => {
    deleteSlackInstallationByConnectionIdMock.mockClear();
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
});
