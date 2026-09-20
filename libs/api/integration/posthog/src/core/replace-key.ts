import type {PosthogRegion} from '@shipfox/api-integration-posthog-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {PosthogApiClient} from '#api/client.js';
import {
  getPosthogInstallationByConnectionId,
  type PosthogInstallation,
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

  await params.credentials.setApiKey({
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    apiKey: params.apiKey,
  });

  const withCredentialVersion = params.withCredentialVersion ?? withPosthogCredentialVersion;
  const updateInstallationCredential =
    params.updateInstallationCredential ?? updatePosthogInstallationCredential;
  const result = await withCredentialVersion({
    connectionId: connection.id,
    credentialVersion: installation.credentialVersion,
    callback: async ({tx, installation: lockedInstallation}) => {
      await updateInstallationCredential({
        connectionId: connection.id,
        keyHint: params.apiKey,
        credentialVersion: lockedInstallation.credentialVersion + 1,
        tx,
      });
      return await params.updateConnection({
        id: connection.id,
        lifecycleStatus: 'active',
        tx,
      });
    },
  });
  if (!result.matched) throw new PosthogCredentialVersionMismatchError(connection.id);
  if (!result.value) throw new PosthogConnectionNotFoundError(connection.id);
  return result.value;
}

export type PosthogReplaceRegion = PosthogRegion;
