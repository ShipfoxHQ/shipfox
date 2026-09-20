import {randomUUID} from 'node:crypto';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import {
  createIntegrationConnection,
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

async function loadPosthogModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createPosthogCredentialStore,
    createPosthogIntegrationProvider,
    createPosthogE2eRoutes,
    db: posthogDb,
    deletePosthogInstallationByConnectionId,
    getPosthogInstallationByConnectionId,
    migrationsPath,
    upsertPosthogInstallation,
  } = await import('@shipfox/api-integration-posthog');

  const rawSecrets = options.secrets?.posthog;
  const posthogSecretPrefix = 'system/integrations/posthog/';
  const secrets = rawSecrets
    ? {
        getSecret: (params: {workspaceId: string; namespace: string; key: string}) =>
          rawSecrets.getSecret({
            ...params,
            namespace: requirePosthogSecretNamespace(params.namespace).slice(
              posthogSecretPrefix.length,
            ),
          }),
        setSecrets: (params: {
          workspaceId: string;
          namespace: string;
          values: Record<string, string>;
          editedBy?: string | null | undefined;
        }) =>
          rawSecrets.setSecrets({
            ...params,
            namespace: requirePosthogSecretNamespace(params.namespace).slice(
              posthogSecretPrefix.length,
            ),
          }),
        deleteSecrets: (params: {
          workspaceId: string;
          namespace: string;
          keys?: string[] | undefined;
        }) =>
          rawSecrets.deleteSecrets({
            ...params,
            namespace: requirePosthogSecretNamespace(params.namespace).slice(
              posthogSecretPrefix.length,
            ),
          }),
      }
    : undefined;
  const credentialStore = secrets
    ? createPosthogCredentialStore({
        resolveConnection: async (connectionId) => {
          const connection = await getIntegrationConnectionById(connectionId);
          return connection ? {workspaceId: connection.workspaceId} : undefined;
        },
        secrets,
      })
    : undefined;

  async function seedPosthogConnection(input: {
    workspaceId: string;
    apiKey: string;
    projectId: string;
    projectName: string;
    organizationId: string;
  }): Promise<CoreIntegrationConnection<'posthog'>> {
    if (!credentialStore) throw new Error('PostHog credential storage is not configured');
    const connectionId = randomUUID();
    await credentialStore.setApiKey({
      connectionId,
      apiKey: input.apiKey,
      workspaceId: input.workspaceId,
    });
    try {
      return await retryConnectionSlugCollision(() =>
        db().transaction(async (tx) => {
          const slug = await resolveUniqueConnectionSlug(
            {
              workspaceId: input.workspaceId,
              provider: 'posthog',
              externalAccountId: input.projectId,
              baseSlug: slugifyConnectionSlug(`posthog_${input.projectName}`, {
                fallback: 'posthog',
              }),
            },
            {tx},
          );
          const connection = await createIntegrationConnection(
            {
              id: connectionId,
              workspaceId: input.workspaceId,
              provider: 'posthog',
              externalAccountId: input.projectId,
              slug,
              displayName: input.projectName,
              lifecycleStatus: 'active',
              capabilities: [],
            },
            {tx},
          );
          await upsertPosthogInstallation(
            {
              connectionId,
              projectId: input.projectId,
              projectName: input.projectName,
              organizationId: input.organizationId,
              keyHint: input.apiKey.slice(-4),
              credentialVersion: 1,
            },
            {tx},
          );
          return connection as CoreIntegrationConnection<'posthog'>;
        }),
      );
    } catch (error) {
      await credentialStore
        .deleteApiKey({connectionId, workspaceId: input.workspaceId})
        .catch(() => undefined);
      throw error;
    }
  }

  const provider = createPosthogIntegrationProvider({
    getPosthogInstallationByConnectionId,
    cleanup: {
      deleteConnectionRecords: async (connection, {tx}) => {
        await deletePosthogInstallationByConnectionId(connection.id, {tx});
      },
      deleteConnectionSecrets: async (connection) => {
        await credentialStore?.deleteApiKey({
          connectionId: connection.id,
          workspaceId: connection.workspaceId,
        });
      },
    },
  });

  return {
    provider,
    e2eRoutes: credentialStore
      ? [createPosthogE2eRoutes({seedPosthogConnection})]
      : [
          createPosthogE2eRoutes({
            seedPosthogConnection: () => {
              return Promise.reject(new Error('PostHog credential storage is not configured'));
            },
          }),
        ],
    database: {
      db: posthogDb,
      migrationsPath,
      databaseNamespace: 'integrations_posthog',
    },
  };
}

function requirePosthogSecretNamespace(namespace: string): string {
  const prefix = 'system/integrations/posthog/';
  if (!namespace.startsWith(prefix)) {
    throw new Error('PostHog provider attempted to access an unscoped secret namespace');
  }
  return namespace;
}

export const posthogProviderModule: IntegrationProviderModule = {
  id: 'posthog',
  enabled: config.INTEGRATIONS_ENABLE_POSTHOG_PROVIDER,
  load: loadPosthogModuleParts,
};
