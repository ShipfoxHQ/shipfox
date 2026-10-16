import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {
  getJamInstallationByConnectionId,
  type JamInstallation,
  type JamVersionGuardResult,
  updateJamInstallationCredential,
  withJamCredentialVersion,
} from '#db/installations.js';
import type {JamCredentialStore} from './credentials.js';
import {
  JamConnectionNotFoundError,
  JamCredentialVersionMismatchError,
  JamInstallationNotFoundError,
  JamWorkspaceMismatchError,
} from './errors.js';
import type {ValidatedJamToken} from './validate-token.js';

export interface ReplaceJamTokenParams {
  connection: IntegrationConnection<'jam'>;
  token: string;
  validateToken: (token: string) => Promise<ValidatedJamToken>;
  credentials: JamCredentialStore;
  getInstallation?: (connectionId: string) => Promise<JamInstallation | undefined>;
  updateConnection: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'jam'> | undefined>;
  withCredentialVersion?: typeof withJamCredentialVersion;
  updateInstallationCredential?: typeof updateJamInstallationCredential;
}

export async function handleJamReplaceToken(
  params: ReplaceJamTokenParams,
): Promise<IntegrationConnection<'jam'>> {
  const {connection} = params;
  const getInstallation = params.getInstallation ?? getJamInstallationByConnectionId;
  const installation = await getInstallation(connection.id);
  if (!installation) throw new JamInstallationNotFoundError(connection.id);

  // Nothing is written until the new token passes, so a working token is never replaced by one
  // that cannot reach the MCP or read Jams.
  const validated = await params.validateToken(params.token);
  if (validated.teamId !== installation.teamId) throw new JamWorkspaceMismatchError();

  const withCredentialVersion = params.withCredentialVersion ?? withJamCredentialVersion;
  const updateInstallationCredential =
    params.updateInstallationCredential ?? updateJamInstallationCredential;
  const previousToken = await params.credentials.getToken(connection.id);
  let secretWriteAttempted = false;
  let result: JamVersionGuardResult<IntegrationConnection<'jam'>>;
  try {
    result = await withCredentialVersion({
      connectionId: connection.id,
      credentialVersion: installation.credentialVersion,
      callback: async ({tx, installation: lockedInstallation}) => {
        secretWriteAttempted = true;
        await params.credentials.setToken({
          connectionId: connection.id,
          workspaceId: connection.workspaceId,
          token: params.token,
        });
        const updatedInstallation = await updateInstallationCredential({
          connectionId: connection.id,
          token: params.token,
          userId: validated.userId,
          userName: validated.userName,
          userEmail: validated.userEmail,
          credentialVersion: lockedInstallation.credentialVersion + 1,
          tx,
        });
        if (!updatedInstallation) throw new JamInstallationNotFoundError(connection.id);

        const updatedConnection = await params.updateConnection({
          id: connection.id,
          lifecycleStatus: 'active',
          tx,
        });
        if (!updatedConnection) throw new JamConnectionNotFoundError(connection.id);
        return updatedConnection;
      },
    });
  } catch (error) {
    if (secretWriteAttempted) {
      try {
        await restorePreviousToken({
          connection,
          credentialVersion: installation.credentialVersion,
          previousToken,
          credentials: params.credentials,
          withCredentialVersion,
        });
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          'Jam token replacement and restoration failed',
        );
      }
    }
    throw error;
  }
  if (!result.matched) throw new JamCredentialVersionMismatchError(connection.id);
  return result.value;
}

async function restorePreviousToken(params: {
  connection: IntegrationConnection<'jam'>;
  credentialVersion: number;
  previousToken: string | null;
  credentials: JamCredentialStore;
  withCredentialVersion: typeof withJamCredentialVersion;
}): Promise<void> {
  await params.withCredentialVersion({
    connectionId: params.connection.id,
    credentialVersion: params.credentialVersion,
    callback: async () => {
      if (params.previousToken === null) {
        await params.credentials.deleteToken({
          connectionId: params.connection.id,
          workspaceId: params.connection.workspaceId,
        });
        return;
      }
      await params.credentials.setToken({
        connectionId: params.connection.id,
        workspaceId: params.connection.workspaceId,
        token: params.previousToken,
      });
    },
  });
}
