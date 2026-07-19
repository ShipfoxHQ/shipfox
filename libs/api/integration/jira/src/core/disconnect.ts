import {deleteJiraInstallationByConnectionId} from '#db/installations.js';
import {jiraSecretsNamespace} from './tokens.js';

export interface DisconnectJiraInstallationParams<Tx = unknown> {
  connectionId: string;
  getConnection(connectionId: string): Promise<{workspaceId: string} | undefined>;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  deleteConnection(params: {connectionId: string}, options: {tx: Tx}): Promise<boolean>;
}

export async function disconnectJiraInstallation<Tx = unknown>(
  params: DisconnectJiraInstallationParams<Tx>,
): Promise<void> {
  const connection = await params.getConnection(params.connectionId);
  if (connection)
    await params.deleteSecrets({
      workspaceId: connection.workspaceId,
      namespace: jiraSecretsNamespace(params.connectionId),
    });
  await params.transaction(async (tx) => {
    await deleteJiraInstallationByConnectionId(params.connectionId, {tx});
    await params.deleteConnection({connectionId: params.connectionId}, {tx});
  });
}
