import {POSTHOG_PROVIDER} from '@shipfox/api-integration-posthog-dto';
import {closeDb, db} from '#db/db.js';
import {getPosthogInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateE2ePosthogConnectionRouteOptions,
  createE2ePosthogConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
import {
  type CreatePosthogE2eRoutesOptions,
  createPosthogE2eRoutes,
} from '#presentation/e2eRoutes/index.js';

export type {PosthogProvider} from '@shipfox/api-integration-posthog-dto';
export type {
  PosthogConnectionResolver,
  PosthogCredentialStore,
  PosthogSecretsStore,
} from '#core/credentials.js';
export {
  createPosthogCredentialStore,
  createPosthogCredentialStoreFromSecrets,
  POSTHOG_API_KEY_SECRET_NAME,
  posthogSecretsNamespace,
} from '#core/credentials.js';
export type {
  PosthogDatabaseExecutor,
  PosthogInstallation,
  PosthogVersionGuardResult,
  UpsertPosthogInstallationParams,
} from '#db/installations.js';
export {
  deletePosthogInstallationByConnectionId,
  getPosthogInstallationByConnectionId,
  getPosthogInstallationByProjectId,
  upsertPosthogInstallation,
  withPosthogCredentialVersion,
  withPosthogInstallationVersionGuard,
} from '#db/installations.js';
export {
  type CreateE2ePosthogConnectionRouteOptions,
  type CreatePosthogE2eRoutesOptions,
  closeDb,
  createE2ePosthogConnectionRoute,
  createPosthogE2eRoutes,
  db,
  migrationsPath,
  POSTHOG_PROVIDER,
};

export interface CreatePosthogIntegrationProviderOptions {
  getPosthogInstallationByConnectionId?: typeof getPosthogInstallationByConnectionId | undefined;
  cleanup?:
    | {
        deleteConnectionRecords?: (
          connection: {id: string},
          options: {tx: unknown},
        ) => Promise<void>;
        deleteConnectionSecrets?: (connection: {id: string; workspaceId: string}) => Promise<void>;
      }
    | undefined;
}

export function createPosthogIntegrationProvider(
  options: CreatePosthogIntegrationProviderOptions = {},
) {
  const getInstallationByConnectionId =
    options.getPosthogInstallationByConnectionId ?? getPosthogInstallationByConnectionId;
  return {
    provider: POSTHOG_PROVIDER,
    displayName: 'PostHog',
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation) return undefined;
      return `https://eu.posthog.com/project/${encodeURIComponent(installation.projectId)}`;
    },
    ...options.cleanup,
  };
}
