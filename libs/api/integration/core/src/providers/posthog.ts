import {randomUUID} from 'node:crypto';
import type {PosthogRegion} from '@shipfox/api-integration-posthog';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import {
  createIntegrationConnection,
  getIntegrationConnectionById,
  getIntegrationConnectionByWorkspaceExternalAccountId,
  resolveUniqueConnectionSlug,
  updateIntegrationConnectionLifecycleStatus,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

async function loadPosthogModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createPosthogApiClient,
    createPosthogConnectionRoutes,
    createPosthogCredentialStore,
    createPosthogE2eRoutes,
    createPosthogInstallation,
    createPosthogIntegrationProvider,
    db: posthogDb,
    deletePosthogInstallationByConnectionId,
    getPosthogInstallationByConnectionId,
    migrationsPath,
    PosthogAgentToolsProvider,
    posthogExternalAccountId,
    withPosthogCredentialVersion,
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

  async function createPosthogConnection(input: {
    id: string;
    workspaceId: string;
    region: PosthogRegion;
    apiKey: string;
    projectId: string;
    projectName: string;
    organizationId: string;
  }): Promise<CoreIntegrationConnection<'posthog'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const externalAccountId = posthogExternalAccountId(input.region, input.projectId);
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'posthog',
            externalAccountId,
            baseSlug: slugifyConnectionSlug(`posthog_${input.projectName}`, {
              fallback: 'posthog',
            }),
          },
          {tx},
        );
        const connection = await createIntegrationConnection(
          {
            id: input.id,
            workspaceId: input.workspaceId,
            provider: 'posthog',
            externalAccountId,
            slug,
            displayName: input.projectName,
            lifecycleStatus: 'active',
            capabilities: credentialStore ? ['agent_tools'] : [],
          },
          {tx},
        );
        await createPosthogInstallation(
          {
            connectionId: input.id,
            region: input.region,
            projectId: input.projectId,
            projectName: input.projectName,
            organizationId: input.organizationId,
            keyHint: input.apiKey,
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'posthog'>;
      }),
    );
  }

  async function seedPosthogConnection(input: {
    workspaceId: string;
    region: PosthogRegion;
    apiKey: string;
    projectId: string;
    projectName: string;
    organizationId: string;
  }): Promise<CoreIntegrationConnection<'posthog'>> {
    if (!credentialStore) throw new Error('PostHog credential storage is not configured');
    const connectionId = randomUUID();
    return await withPosthogSeedCredential({
      credentialStore,
      connectionId,
      workspaceId: input.workspaceId,
      apiKey: input.apiKey,
      createConnection: () => createPosthogConnection({...input, id: connectionId}),
    });
  }

  const agentTools = credentialStore
    ? new PosthogAgentToolsProvider({
        credentialStore,
        getInstallationByConnectionId: getPosthogInstallationByConnectionId,
        api: createPosthogApiClient({apiBaseUrl: config.POSTHOG_API_BASE_URL}),
        endpoint: config.POSTHOG_MCP_ENDPOINT,
        markConnectionError: async ({connectionId, credentialVersion}) => {
          await withPosthogCredentialVersion({
            connectionId,
            credentialVersion,
            callback: async ({tx}) => {
              await updateIntegrationConnectionLifecycleStatus(
                {id: connectionId, lifecycleStatus: 'error'},
                {tx: tx as never},
              );
            },
          });
        },
      })
    : undefined;

  const posthogApi = createPosthogApiClient({apiBaseUrl: config.POSTHOG_API_BASE_URL});
  const connectionRoutes = credentialStore
    ? createPosthogConnectionRoutes({
        posthog: posthogApi,
        credentials: credentialStore,
        getExistingConnection: async ({workspaceId, externalAccountId}) =>
          (await getIntegrationConnectionByWorkspaceExternalAccountId({
            workspaceId,
            provider: 'posthog',
            externalAccountId,
          })) as CoreIntegrationConnection<'posthog'> | undefined,
        createConnection: createPosthogConnection,
        getConnection: async (connectionId) =>
          (await getIntegrationConnectionById(connectionId)) as
            | CoreIntegrationConnection<'posthog'>
            | undefined,
        updateConnection: async ({id, lifecycleStatus, tx}) =>
          (await updateIntegrationConnectionLifecycleStatus(
            {id, lifecycleStatus},
            {tx: tx as never},
          )) as CoreIntegrationConnection<'posthog'> | undefined,
      })
    : undefined;

  const provider = createPosthogIntegrationProvider({
    getPosthogInstallationByConnectionId,
    ...(agentTools ? {agentTools} : {}),
    routes: connectionRoutes ? [connectionRoutes] : [],
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

interface PosthogSeedCredentialStore {
  setApiKey(params: {connectionId: string; apiKey: string; workspaceId: string}): Promise<void>;
  deleteApiKey(params: {connectionId: string; workspaceId: string}): Promise<number>;
}

export async function withPosthogSeedCredential<T>(params: {
  credentialStore: PosthogSeedCredentialStore;
  connectionId: string;
  workspaceId: string;
  apiKey: string;
  createConnection: () => Promise<T>;
}): Promise<T> {
  try {
    await params.credentialStore.setApiKey({
      connectionId: params.connectionId,
      apiKey: params.apiKey,
      workspaceId: params.workspaceId,
    });
    return await params.createConnection();
  } catch (error) {
    await params.credentialStore
      .deleteApiKey({connectionId: params.connectionId, workspaceId: params.workspaceId})
      .catch(() => undefined);
    throw error;
  }
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
