import {randomUUID} from 'node:crypto';
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
import {scopeProviderSecrets, withSeededSecret} from '#providers/provider-secrets.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

async function loadJamModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createJamCredentialStore,
    createJamConnectionRoutes,
    createJamE2eRoutes,
    createJamInstallation,
    createJamIntegrationProvider,
    createJamIntrospectionClient,
    createJamTokenValidator,
    db: jamDb,
    deleteJamInstallationByConnectionId,
    getJamInstallationByConnectionId,
    JamAgentToolsProvider,
    migrationsPath,
    withJamCredentialVersion,
  } = await import('@shipfox/api-integration-jam');

  const secrets = options.secrets?.jam
    ? scopeProviderSecrets({secrets: options.secrets.jam, provider: 'jam'})
    : undefined;
  const credentialStore = secrets
    ? createJamCredentialStore({
        resolveConnection: async (connectionId) => {
          const connection = await getIntegrationConnectionById(connectionId);
          return connection ? {workspaceId: connection.workspaceId} : undefined;
        },
        secrets,
      })
    : undefined;

  async function createJamConnection(input: {
    id: string;
    workspaceId: string;
    token: string;
    teamId: string;
    userId: string;
    userName: string;
    userEmail: string | null;
    lifecycleStatus?: CoreIntegrationConnection<'jam'>['lifecycleStatus'] | undefined;
  }): Promise<CoreIntegrationConnection<'jam'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'jam',
            externalAccountId: input.teamId,
            baseSlug: slugifyConnectionSlug('jam', {fallback: 'jam'}),
          },
          {tx},
        );
        const connection = await createIntegrationConnection(
          {
            id: input.id,
            workspaceId: input.workspaceId,
            provider: 'jam',
            externalAccountId: input.teamId,
            slug,
            displayName: 'Jam',
            lifecycleStatus: input.lifecycleStatus ?? 'active',
            capabilities: credentialStore ? ['agent_tools'] : [],
          },
          {tx},
        );
        await createJamInstallation(
          {
            connectionId: input.id,
            teamId: input.teamId,
            userId: input.userId,
            userName: input.userName,
            userEmail: input.userEmail,
            token: input.token,
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'jam'>;
      }),
    );
  }

  async function seedJamConnection(input: {
    workspaceId: string;
    token: string;
    teamId: string;
    userId: string;
    userName: string;
    userEmail?: string | undefined;
    lifecycleStatus?: CoreIntegrationConnection<'jam'>['lifecycleStatus'] | undefined;
  }): Promise<CoreIntegrationConnection<'jam'>> {
    if (!credentialStore) throw new Error('Jam credential storage is not configured');
    const connectionId = randomUUID();
    return await withSeededSecret({
      setSecret: () =>
        credentialStore.setToken({
          connectionId,
          workspaceId: input.workspaceId,
          token: input.token,
        }),
      deleteSecret: () =>
        credentialStore.deleteToken({connectionId, workspaceId: input.workspaceId}),
      createConnection: () =>
        createJamConnection({...input, userEmail: input.userEmail ?? null, id: connectionId}),
    });
  }

  const agentTools = credentialStore
    ? new JamAgentToolsProvider({
        credentialStore,
        getInstallationByConnectionId: getJamInstallationByConnectionId,
        endpoint: config.JAM_MCP_ENDPOINT,
        markConnectionError: async ({connectionId, credentialVersion}) => {
          await withJamCredentialVersion({
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

  const connectionRoutes = credentialStore
    ? createJamConnectionRoutes({
        validateToken: createJamTokenValidator({
          introspection: createJamIntrospectionClient({apiBaseUrl: config.JAM_API_BASE_URL}),
          endpoint: config.JAM_MCP_ENDPOINT,
        }),
        credentials: credentialStore,
        getExistingConnection: async ({workspaceId, externalAccountId}) =>
          (await getIntegrationConnectionByWorkspaceExternalAccountId({
            workspaceId,
            provider: 'jam',
            externalAccountId,
          })) as CoreIntegrationConnection<'jam'> | undefined,
        createConnection: createJamConnection,
        getConnection: async (connectionId) =>
          (await getIntegrationConnectionById(connectionId)) as
            | CoreIntegrationConnection<'jam'>
            | undefined,
        updateConnection: async ({id, lifecycleStatus, tx}) =>
          (await updateIntegrationConnectionLifecycleStatus(
            {id, lifecycleStatus},
            {tx: tx as never},
          )) as CoreIntegrationConnection<'jam'> | undefined,
      })
    : undefined;

  const provider = createJamIntegrationProvider({
    ...(agentTools ? {agentTools} : {}),
    routes: connectionRoutes ? [connectionRoutes] : [],
    cleanup: {
      deleteConnectionRecords: async (connection, {tx}) => {
        await deleteJamInstallationByConnectionId(connection.id, {tx});
      },
      deleteConnectionSecrets: async (connection) => {
        await credentialStore?.deleteToken({
          connectionId: connection.id,
          workspaceId: connection.workspaceId,
        });
      },
    },
  });

  return {
    provider,
    e2eRoutes: credentialStore
      ? [createJamE2eRoutes({seedJamConnection})]
      : [
          createJamE2eRoutes({
            seedJamConnection: () => {
              return Promise.reject(new Error('Jam credential storage is not configured'));
            },
          }),
        ],
    database: {
      db: jamDb,
      migrationsPath,
      databaseNamespace: 'integrations_jam',
    },
  };
}

export const jamProviderModule: IntegrationProviderModule = {
  id: 'jam',
  enabled: true,
  load: loadJamModuleParts,
};
