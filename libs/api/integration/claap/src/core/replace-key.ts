import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {
  type ClaapInstallation,
  type ClaapVersionGuardResult,
  getClaapInstallationByConnectionId,
  updateClaapInstallationCredential,
  withClaapCredentialVersion,
} from '#db/installations.js';
import {assertClaapApiKey} from './connect.js';
import type {ClaapCredentialStore} from './credentials.js';
import {
  ClaapConnectionNotFoundError,
  ClaapCredentialVersionMismatchError,
  ClaapInstallationNotFoundError,
  ClaapUnexpectedWorkspaceCountError,
  ClaapWorkspaceMismatchError,
} from './errors.js';
import type {ClaapWorkspace} from './mcp-client.js';

export interface ReplaceClaapApiKeyParams {
  connectionId: string;
  apiKey: string;
  listClaapWorkspaces: (apiKey: string) => Promise<ClaapWorkspace[]>;
  credentials: ClaapCredentialStore;
  getConnection: (connectionId: string) => Promise<IntegrationConnection<'claap'> | undefined>;
  getInstallation?: (connectionId: string) => Promise<ClaapInstallation | undefined>;
  updateConnection: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'claap'> | undefined>;
  withCredentialVersion?: typeof withClaapCredentialVersion;
  updateInstallationCredential?: typeof updateClaapInstallationCredential;
}

export async function handleClaapReplaceApiKey(
  params: ReplaceClaapApiKeyParams,
): Promise<IntegrationConnection<'claap'>> {
  assertClaapApiKey(params.apiKey);
  const connection = await params.getConnection(params.connectionId);
  if (!connection) throw new ClaapConnectionNotFoundError(params.connectionId);

  const getInstallation = params.getInstallation ?? getClaapInstallationByConnectionId;
  const installation = await getInstallation(params.connectionId);
  if (!installation) throw new ClaapInstallationNotFoundError(params.connectionId);

  const workspaces = await params.listClaapWorkspaces(params.apiKey);
  if (workspaces.length !== 1) throw new ClaapUnexpectedWorkspaceCountError(workspaces.length);
  if (workspaces[0]?.workspaceId !== installation.workspaceId) {
    throw new ClaapWorkspaceMismatchError(installation.workspaceName);
  }

  const withCredentialVersion = params.withCredentialVersion ?? withClaapCredentialVersion;
  const updateInstallationCredential =
    params.updateInstallationCredential ?? updateClaapInstallationCredential;
  // Read under the installation lock, so the key to restore is the committed one even when
  // another replacement is running.
  let previousApiKey: string | null = null;
  let secretWriteAttempted = false;
  let result: ClaapVersionGuardResult<IntegrationConnection<'claap'>>;
  try {
    result = await withCredentialVersion({
      connectionId: connection.id,
      credentialVersion: installation.credentialVersion,
      callback: async ({tx, installation: lockedInstallation}) => {
        previousApiKey = await params.credentials.getApiKey(connection.id);
        secretWriteAttempted = true;
        await params.credentials.setApiKey({
          connectionId: connection.id,
          workspaceId: connection.workspaceId,
          apiKey: params.apiKey,
        });
        const updatedInstallation = await updateInstallationCredential({
          connectionId: connection.id,
          keyHint: params.apiKey,
          credentialVersion: lockedInstallation.credentialVersion + 1,
          tx,
        });
        if (!updatedInstallation) throw new ClaapInstallationNotFoundError(connection.id);

        // Only a connection that failed on its key comes back. A disabled one stays disabled.
        if (connection.lifecycleStatus !== 'error') return connection;
        const updatedConnection = await params.updateConnection({
          id: connection.id,
          lifecycleStatus: 'active',
          tx,
        });
        if (!updatedConnection) throw new ClaapConnectionNotFoundError(connection.id);
        return updatedConnection;
      },
    });
  } catch (error) {
    if (secretWriteAttempted) {
      try {
        await restorePreviousApiKey({
          connection,
          credentialVersion: installation.credentialVersion,
          previousApiKey,
          credentials: params.credentials,
          withCredentialVersion,
        });
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'Claap API key replacement and restoration failed',
        );
      }
    }
    throw error;
  }
  if (!result.matched) throw new ClaapCredentialVersionMismatchError(connection.id);
  return result.value;
}

async function restorePreviousApiKey(params: {
  connection: IntegrationConnection<'claap'>;
  credentialVersion: number;
  previousApiKey: string | null;
  credentials: ClaapCredentialStore;
  withCredentialVersion: typeof withClaapCredentialVersion;
}): Promise<void> {
  await params.withCredentialVersion({
    connectionId: params.connection.id,
    credentialVersion: params.credentialVersion,
    callback: async () => {
      if (params.previousApiKey === null) {
        await params.credentials.deleteApiKey({
          connectionId: params.connection.id,
          workspaceId: params.connection.workspaceId,
        });
        return;
      }
      await params.credentials.setApiKey({
        connectionId: params.connection.id,
        workspaceId: params.connection.workspaceId,
        apiKey: params.previousApiKey,
      });
    },
  });
}
