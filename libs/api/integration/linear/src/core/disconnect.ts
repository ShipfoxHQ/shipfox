import {deleteLinearInstallationByConnectionId} from '#db/installations.js';
import {linearSecretsNamespace} from './tokens.js';

export interface DisconnectLinearInstallationParams<Tx = unknown> {
  connectionId: string;
  getConnection(connectionId: string): Promise<{workspaceId: string} | undefined>;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  deleteConnection(params: {connectionId: string}, options: {tx: Tx}): Promise<boolean>;
}

export async function disconnectLinearInstallation<Tx = unknown>(
  params: DisconnectLinearInstallationParams<Tx>,
): Promise<void> {
  const connection = await params.getConnection(params.connectionId);
  if (connection) {
    await params.deleteSecrets({
      workspaceId: connection.workspaceId,
      namespace: linearSecretsNamespace(params.connectionId),
    });
  }

  await params.transaction(async (tx) => {
    await deleteLinearInstallationByConnectionId(params.connectionId, {tx});
    await params.deleteConnection({connectionId: params.connectionId}, {tx});
  });
}
