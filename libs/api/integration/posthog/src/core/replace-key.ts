import type {PosthogRegion} from '@shipfox/api-integration-posthog-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {PosthogApiClient} from '#api/client.js';
import {
  getPosthogInstallationByConnectionId,
  type PosthogInstallation,
  type PosthogVersionGuardResult,
  updatePosthogInstallationCredential,
  withPosthogCredentialVersion,
} from '#db/installations.js';
import {assertPersonalApiKey} from './connect.js';
import type {PosthogCredentialStore} from './credentials.js';
import {
  PosthogConnectionNotFoundError,
  PosthogCredentialVersionMismatchError,
  PosthogInstallationNotFoundError,
  PosthogProjectMismatchError,
} from './errors.js';

export interface ReplacePosthogApiKeyParams {
  connectionId: string;
  apiKey: string;
  posthog: PosthogApiClient;
  credentials: PosthogCredentialStore;
  getConnection: (connectionId: string) => Promise<IntegrationConnection<'posthog'> | undefined>;
  getInstallation?: (connectionId: string) => Promise<PosthogInstallation | undefined>;
  updateConnection: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'posthog'> | undefined>;
  withCredentialVersion?: typeof withPosthogCredentialVersion;
  updateInstallationCredential?: typeof updatePosthogInstallationCredential;
}

export async function handlePosthogReplaceApiKey(
  params: ReplacePosthogApiKeyParams,
): Promise<IntegrationConnection<'posthog'>> {
  assertPersonalApiKey(params.apiKey);
  const connection = await params.getConnection(params.connectionId);
  if (!connection) throw new PosthogConnectionNotFoundError(params.connectionId);

  const getInstallation = params.getInstallation ?? getPosthogInstallationByConnectionId;
  const installation = await getInstallation(params.connectionId);
  if (!installation) throw new PosthogInstallationNotFoundError(params.connectionId);

  const projects = await params.posthog.listProjects({
    region: installation.region,
    apiKey: params.apiKey,
  });
  if (!projects.some((project) => project.id === installation.projectId)) {
    throw new PosthogProjectMismatchError(installation.projectId);
  }

  await params.posthog.validateQuery({
    region: installation.region,
    apiKey: params.apiKey,
    projectId: installation.projectId,
  });

  const withCredentialVersion = params.withCredentialVersion ?? withPosthogCredentialVersion;
  const updateInstallationCredential =
    params.updateInstallationCredential ?? updatePosthogInstallationCredential;
  const previousApiKey = await params.credentials.getApiKey(connection.id);
  let secretWriteAttempted = false;
  let result: PosthogVersionGuardResult<IntegrationConnection<'posthog'>>;
  try {
    result = await withCredentialVersion({
      connectionId: connection.id,
      credentialVersion: installation.credentialVersion,
      callback: async ({tx, installation: lockedInstallation}) => {
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
        if (!updatedInstallation) throw new PosthogInstallationNotFoundError(connection.id);

        const updatedConnection = await params.updateConnection({
          id: connection.id,
          lifecycleStatus: 'active',
          tx,
        });
        if (!updatedConnection) throw new PosthogConnectionNotFoundError(connection.id);
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
          'PostHog API key replacement and restoration failed',
        );
      }
    }
    throw error;
  }
  if (!result.matched) throw new PosthogCredentialVersionMismatchError(connection.id);
  return result.value;
}

async function restorePreviousApiKey(params: {
  connection: IntegrationConnection<'posthog'>;
  credentialVersion: number;
  previousApiKey: string | null;
  credentials: PosthogCredentialStore;
  withCredentialVersion: typeof withPosthogCredentialVersion;
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

export type PosthogReplaceRegion = PosthogRegion;
