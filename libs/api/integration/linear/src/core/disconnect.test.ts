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
});
