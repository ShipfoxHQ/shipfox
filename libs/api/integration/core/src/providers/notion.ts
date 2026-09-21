import type {
  ConnectNotionInstallationInput,
  NotionSecretsStore,
} from '@shipfox/api-integration-notion';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  updateIntegrationConnectionLifecycleStatus,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {publishIntegrationEventReceived, recordDeliveryOnly} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const NOTION_SECRETS_NAMESPACE_PREFIX = 'system/integrations/notion/';

async function loadNotionModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createNotionAgentToolsClient,
    createNotionApiClient,
    createNotionE2eRoutes,
    createNotionIntegrationProvider,
    createNotionTokenStore,
    deleteNotionInstallationByConnectionId,
    getNotionInstallationByConnectionId,
    getNotionInstallationByWorkspaceId,
    notionSecretsNamespace,
    restoreNotionInstallation,
    prepareNotionTokenRevocation,
    withNotionGrantLock,
    db: notionDb,
    migrationsPath: notionMigrationsPath,
    upsertNotionInstallation,
  } = await import('@shipfox/api-integration-notion');
  let providerCapabilities: IntegrationCapability[] = [];

  async function getExistingNotionConnection(input: {
    notionWorkspaceId: string;
  }): Promise<CoreIntegrationConnection<'notion'> | undefined> {
    const installation = await getNotionInstallationByWorkspaceId(input.notionWorkspaceId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    return connection as CoreIntegrationConnection<'notion'> | undefined;
  }

  async function connectNotionInstallation(
    input: ConnectNotionInstallationInput,
  ): Promise<CoreIntegrationConnection<'notion'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'notion',
            externalAccountId: input.notionWorkspaceId,
            baseSlug: slugifyConnectionSlug(
              `notion_${input.workspaceName || input.notionWorkspaceId}`,
              {
                fallback: 'notion',
              },
            ),
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'notion',
            externalAccountId: input.notionWorkspaceId,
            slug,
            displayName: input.displayName,
            lifecycleStatus: input.lifecycleStatus ?? 'error',
            capabilities: providerCapabilities,
            actorUserId: input.actorUserId,
          },
          {tx},
        );
        await upsertNotionInstallation(
          {
            connectionId: connection.id,
            notionWorkspaceId: input.notionWorkspaceId,
            workspaceName: input.workspaceName,
            botId: input.botId,
            authorizedByUserId: input.authorizedByUserId,
            tokenExpiresAt: input.tokenExpiresAt,
            status: 'installed',
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'notion'>;
      }),
    );
  }

  async function disconnectNotionInstallation(input: {connectionId: string}): Promise<void> {
    const connection = await getIntegrationConnectionById(input.connectionId);
    if (!connection) return;
    await db().transaction(async (tx) => {
      await deleteNotionInstallationByConnectionId(input.connectionId, {tx});
      await deleteIntegrationConnection({id: input.connectionId}, {tx});
    });
    await (options.secrets?.notion?.deleteSecrets({
      workspaceId: connection.workspaceId,
      namespace: notionNamespaceSuffix(notionSecretsNamespace(input.connectionId)),
    }) ?? Promise.resolve(0));
  }

  const fallbackSecrets: NotionSecretsStore = {
    getSecret: () => Promise.resolve(null),
    setSecrets: () => Promise.reject(new Error('Notion token storage is not configured')),
    deleteSecrets: () => Promise.resolve(0),
  };
  const secrets: NotionSecretsStore = options.secrets?.notion
    ? {
        getSecret: (params) =>
          options.secrets?.notion?.getSecret({
            ...params,
            namespace: notionNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(null),
        setSecrets: (params) =>
          options.secrets?.notion?.setSecrets({
            ...params,
            namespace: notionNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(),
        deleteSecrets: (params) =>
          options.secrets?.notion?.deleteSecrets({
            ...params,
            namespace: notionNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(0),
      }
    : fallbackSecrets;
  const notion = createNotionApiClient();
  const tokenStore = createNotionTokenStore({
    client: notion,
    resolveConnection: async (connectionId) => getIntegrationConnectionById(connectionId),
    secrets,
    markConnectionError: async ({connectionId}) => {
      await updateIntegrationConnectionLifecycleStatus({
        id: connectionId,
        lifecycleStatus: 'error',
      });
    },
  });

  const integrationProvider = createNotionIntegrationProvider({
    agentTools: {
      notion: createNotionAgentToolsClient(),
      tokenStore,
    },
    routes: {
      notion,
      tokenStore,
      getExistingNotionConnection,
      getNotionInstallationByConnectionId,
      connectNotionInstallation,
      restoreNotionInstallation,
      disconnectNotionInstallation,
      ...(options.requireActiveWorkspaceMembership
        ? {requireActiveWorkspaceMembership: options.requireActiveWorkspaceMembership}
        : {}),
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly,
      getIntegrationConnectionById,
    },
    cleanup: {
      deleteConnectionRemoteResources: async (connection) =>
        withNotionGrantLock(connection.id, () =>
          prepareNotionTokenRevocation({
            connectionId: connection.id,
            tokenStore,
            notion,
          }),
        ),
      deleteConnectionRecords: async (connection, {tx}) => {
        await deleteNotionInstallationByConnectionId(connection.id, {tx});
      },
      deleteConnectionSecrets: async (connection) => {
        await withNotionGrantLock(connection.id, async () => {
          await (options.secrets?.notion?.deleteSecrets({
            workspaceId: connection.workspaceId,
            namespace: notionNamespaceSuffix(notionSecretsNamespace(connection.id)),
          }) ?? Promise.resolve(0));
        });
      },
    },
  });
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    e2eRoutes: [
      createNotionE2eRoutes({
        tokenStore,
        getExistingNotionConnection,
        connectNotionInstallation,
        disconnectNotionInstallation,
        connectionCapabilities: providerCapabilities,
      }),
    ],
    webhookProcessors: integrationProvider.webhookProcessors,
    database: {
      db: notionDb,
      migrationsPath: notionMigrationsPath,
      databaseNamespace: 'integrations_notion',
    },
  };
}

export const notionProviderModule: IntegrationProviderModule = {
  id: 'notion',
  enabled: config.INTEGRATIONS_ENABLE_NOTION_PROVIDER,
  load: loadNotionModuleParts,
};

export function notionNamespaceSuffix(namespace: string): string {
  if (!namespace.startsWith(NOTION_SECRETS_NAMESPACE_PREFIX)) {
    throw new Error('Notion provider attempted to access an unscoped secret namespace');
  }
  return namespace.slice(NOTION_SECRETS_NAMESPACE_PREFIX.length);
}
