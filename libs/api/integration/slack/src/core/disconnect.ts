import {deleteSlackInstallationByConnectionId} from '#db/installations.js';
import {slackSecretsNamespace} from './tokens.js';

export interface DisconnectSlackInstallationParams<Tx = unknown> {
  connectionId: string;
  getConnection(connectionId: string): Promise<{workspaceId: string} | undefined>;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  deleteConnection(params: {connectionId: string}, options: {tx: Tx}): Promise<boolean>;
}

export async function disconnectSlackInstallation<Tx = unknown>(
  params: DisconnectSlackInstallationParams<Tx>,
): Promise<void> {
  const connection = await params.getConnection(params.connectionId);
  if (connection) {
    await params.deleteSecrets({
      workspaceId: connection.workspaceId,
      namespace: slackSecretsNamespace(params.connectionId),
    });
  }
  await params.transaction(async (tx) => {
    await deleteSlackInstallationByConnectionId(params.connectionId, {tx});
    await params.deleteConnection({connectionId: params.connectionId}, {tx});
  });
}
