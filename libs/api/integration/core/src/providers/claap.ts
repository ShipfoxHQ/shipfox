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
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const CLAAP_SECRET_PREFIX = 'system/integrations/claap/';

async function loadClaapModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    ClaapAgentToolsProvider,
    createClaapConnectionRoutes,
    createClaapCredentialStore,
    createClaapE2eRoutes,
    createClaapInstallation,
    createClaapIntegrationProvider,
    db: claapDb,
    deleteClaapInstallationByConnectionId,
    getClaapInstallationByConnectionId,
    listClaapWorkspaces,
    migrationsPath,
    withClaapCredentialVersion,
  } = await import('@shipfox/api-integration-claap');

  const endpoint = new URL(config.CLAAP_MCP_ENDPOINT);
  const rawSecrets = options.secrets?.claap;
  const secrets = rawSecrets
    ? {
        getSecret: (params: {workspaceId: string; namespace: string; key: string}) =>
          rawSecrets.getSecret({...params, namespace: scopedClaapNamespace(params.namespace)}),
        setSecrets: (params: {
          workspaceId: string;
          namespace: string;
          values: Record<string, string>;
          editedBy?: string | null | undefined;
        }) => rawSecrets.setSecrets({...params, namespace: scopedClaapNamespace(params.namespace)}),
        deleteSecrets: (params: {
          workspaceId: string;
          namespace: string;
          keys?: string[] | undefined;
        }) =>
          rawSecrets.deleteSecrets({...params, namespace: scopedClaapNamespace(params.namespace)}),
      }
    : undefined;
  const credentialStore = secrets
    ? createClaapCredentialStore({
        resolveConnection: async (connectionId) => {
          const connection = await getIntegrationConnectionById(connectionId);
          return connection ? {workspaceId: connection.workspaceId} : undefined;
        },
        secrets,
      })
    : undefined;

  async function createClaapConnection(input: {
    id: string;
    workspaceId: string;
    apiKey: string;
    claapWorkspaceId: string;
    claapWorkspaceName: string;
    lifecycleStatus?: CoreIntegrationConnection<'claap'>['lifecycleStatus'] | undefined;
  }): Promise<CoreIntegrationConnection<'claap'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'claap',
            externalAccountId: input.claapWorkspaceId,
            baseSlug: slugifyConnectionSlug(`claap_${input.claapWorkspaceName}`, {
              fallback: 'claap',
            }),
          },
          {tx},
        );
        const connection = await createIntegrationConnection(
          {
            id: input.id,
            workspaceId: input.workspaceId,
            provider: 'claap',
            externalAccountId: input.claapWorkspaceId,
            slug,
            displayName: `Claap ${input.claapWorkspaceName}`,
            lifecycleStatus: input.lifecycleStatus ?? 'active',
            capabilities: credentialStore ? ['agent_tools'] : [],
          },
          {tx},
        );
        await createClaapInstallation(
          {
            connectionId: input.id,
            workspaceId: input.claapWorkspaceId,
            workspaceName: input.claapWorkspaceName,
            keyHint: input.apiKey,
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'claap'>;
      }),
    );
  }

  async function seedClaapConnection(input: {
    workspaceId: string;
    apiKey: string;
    claapWorkspaceId: string;
    claapWorkspaceName: string;
    lifecycleStatus?: CoreIntegrationConnection<'claap'>['lifecycleStatus'] | undefined;
  }): Promise<CoreIntegrationConnection<'claap'>> {
    if (!credentialStore) throw new Error('Claap credential storage is not configured');
    const connectionId = randomUUID();
    try {
      await credentialStore.setApiKey({
        connectionId,
        apiKey: input.apiKey,
        workspaceId: input.workspaceId,
      });
      return await createClaapConnection({...input, id: connectionId});
    } catch (error) {
      await credentialStore
        .deleteApiKey({connectionId, workspaceId: input.workspaceId})
        .catch(() => undefined);
      throw error;
    }
  }

  const agentTools = credentialStore
    ? new ClaapAgentToolsProvider({
        credentialStore,
        getInstallationByConnectionId: getClaapInstallationByConnectionId,
        endpoint,
        markConnectionError: async ({connectionId, credentialVersion}) => {
          await withClaapCredentialVersion({
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
    ? createClaapConnectionRoutes({
        listClaapWorkspaces: (apiKey) => listClaapWorkspaces({endpoint, apiKey}),
        credentials: credentialStore,
        getExistingConnection: async ({workspaceId, externalAccountId}) =>
          (await getIntegrationConnectionByWorkspaceExternalAccountId({
            workspaceId,
            provider: 'claap',
            externalAccountId,
          })) as CoreIntegrationConnection<'claap'> | undefined,
        createConnection: createClaapConnection,
        getConnection: async (connectionId) =>
          (await getIntegrationConnectionById(connectionId)) as
            | CoreIntegrationConnection<'claap'>
            | undefined,
        updateConnection: async ({id, lifecycleStatus, tx}) =>
          (await updateIntegrationConnectionLifecycleStatus(
            {id, lifecycleStatus},
            {tx: tx as never},
          )) as CoreIntegrationConnection<'claap'> | undefined,
      })
    : undefined;

  const provider = createClaapIntegrationProvider({
    ...(agentTools ? {agentTools} : {}),
    routes: connectionRoutes ? [connectionRoutes] : [],
    cleanup: {
      deleteConnectionRecords: async (connection, {tx}) => {
        await deleteClaapInstallationByConnectionId(connection.id, {tx});
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
    e2eRoutes: [
      createClaapE2eRoutes({
        seedClaapConnection: credentialStore
          ? seedClaapConnection
          : () => Promise.reject(new Error('Claap credential storage is not configured')),
      }),
    ],
    database: {
      db: claapDb,
      migrationsPath,
      databaseNamespace: 'integrations_claap',
    },
  };
}

function scopedClaapNamespace(namespace: string): string {
  if (!namespace.startsWith(CLAAP_SECRET_PREFIX)) {
    throw new Error('Claap provider attempted to access an unscoped secret namespace');
  }
  return namespace.slice(CLAAP_SECRET_PREFIX.length);
}

export const claapProviderModule: IntegrationProviderModule = {
  id: 'claap',
  enabled: true,
  load: loadClaapModuleParts,
};
