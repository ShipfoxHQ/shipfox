vi.mock('#db/installations.js', () => ({
  deleteJiraInstallationByConnectionId: vi.fn().mockResolvedValue(true),
}));

import {disconnectJiraInstallation} from './disconnect.js';

describe('disconnectJiraInstallation', () => {
  it('deletes secrets, installation, and connection when the connection exists', async () => {
    const deleteSecrets = vi.fn().mockResolvedValue(1);
    const deleteConnection = vi.fn().mockResolvedValue(true);
    const transaction = vi.fn(async (fn) => await fn({}));

    await disconnectJiraInstallation({
      connectionId: crypto.randomUUID(),
      getConnection: vi.fn().mockResolvedValue({workspaceId: crypto.randomUUID()}),
      deleteSecrets,
      transaction,
      deleteConnection,
    });

    expect(deleteSecrets).toHaveBeenCalledOnce();
    expect(deleteConnection).toHaveBeenCalledOnce();
  });
});
