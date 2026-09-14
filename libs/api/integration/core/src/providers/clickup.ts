import type {
  ClickUpInstallation,
  ClickUpSecretsStore,
  ConnectClickUpInstallationInput,
} from '@shipfox/api-integration-clickup';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
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

const CLICKUP_SECRETS_NAMESPACE_PREFIX = 'system/integrations/clickup/';

async function loadClickUpModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    createClickUpAgentToolsClient,
    createClickUpApiClient,
    createClickUpE2eRoutes,
    createClickUpIntegrationProvider,
    createClickUpTokenStore,
    deleteClickUpInstallationByConnectionId,
    getClickUpInstallationByConnectionId,
    getClickUpInstallationByTeamId,
    clickupWebhookUrl,
    db: clickupDb,
    clickupSecretsNamespace,
    migrationsPath: clickupMigrationsPath,
    updateClickUpInstallationWebhook,
    upsertClickUpInstallation,
    withClickUpInstallationLock,
  } = await import('@shipfox/api-integration-clickup');
  const clickup = createClickUpApiClient();
  let providerCapabilities: IntegrationCapability[] = [];

  async function getExistingClickUpConnection(input: {
    teamId: string;
  }): Promise<CoreIntegrationConnection<'clickup'> | undefined> {
    const installation = await getClickUpInstallationByTeamId(input.teamId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    return connection as CoreIntegrationConnection<'clickup'> | undefined;
  }

  async function connectClickUpInstallation(
    input: ConnectClickUpInstallationInput,
  ): Promise<CoreIntegrationConnection<'clickup'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'clickup',
            externalAccountId: input.teamId,
            baseSlug: slugifyConnectionSlug(`clickup_${input.teamName || input.teamId}`, {
              fallback: 'clickup',
            }),
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'clickup',
            externalAccountId: input.teamId,
            slug,
            displayName: input.displayName,
            lifecycleStatus: input.lifecycleStatus ?? 'error',
            capabilities: providerCapabilities,
          },
          {tx},
        );
        await upsertClickUpInstallation(
          {
            connectionId: connection.id,
            teamId: input.teamId,
            teamName: input.teamName,
            authorizingUserId: input.authorizingUserId,
            webhookId: input.webhookId,
            status: 'installed',
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'clickup'>;
      }),
    );
  }

  async function disconnectClickUpInstallation(input: {
    connectionId: string;
    lockAlreadyHeld?: boolean | undefined;
  }): Promise<void> {
    const disconnect = async (): Promise<void> => {
      const connection = await getIntegrationConnectionById(input.connectionId);
      if (!connection) return;
      let installation: ClickUpInstallation | undefined;
      try {
        installation = await getClickUpInstallationByConnectionId(input.connectionId);
      } catch (error) {
        logger().warn(
          {err: error, connectionId: input.connectionId},
          'ClickUp webhook metadata lookup failed during disconnect',
        );
      }
      if (installation?.webhookId) {
        try {
          const accessToken = await tokenStore.getAccessToken({connectionId: input.connectionId});
          await clickup.deleteWebhook({
            accessToken,
            webhookId: installation.webhookId,
          });
        } catch (error) {
          logger().warn(
            {err: error, connectionId: input.connectionId, webhookId: installation.webhookId},
            'ClickUp webhook deletion failed during disconnect',
          );
        }
      }
      await db().transaction(async (tx) => {
        await deleteClickUpInstallationByConnectionId(input.connectionId, {tx});
        await deleteIntegrationConnection({id: input.connectionId}, {tx});
      });
      await (options.secrets?.clickup?.deleteSecrets({
        workspaceId: connection.workspaceId,
        namespace: clickupNamespaceSuffix(clickupSecretsNamespace(input.connectionId)),
      }) ?? Promise.resolve(0));
    };
    if (input.lockAlreadyHeld) {
      await disconnect();
      return;
    }
    const connection = await getIntegrationConnectionById(input.connectionId);
    if (!connection) return;
    await withClickUpInstallationLock(connection.externalAccountId, disconnect);
  }

  const fallbackSecrets: ClickUpSecretsStore = {
    getSecret: () => Promise.resolve(null),
    setSecrets: () => Promise.reject(new Error('ClickUp token storage is not configured')),
  };
  const secrets: ClickUpSecretsStore = options.secrets?.clickup
    ? {
        getSecret: (params) =>
          options.secrets?.clickup?.getSecret({
            ...params,
            namespace: clickupNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(null),
        setSecrets: (params) =>
          options.secrets?.clickup?.setSecrets({
            ...params,
            namespace: clickupNamespaceSuffix(params.namespace),
          }) ?? Promise.resolve(),
      }
    : fallbackSecrets;
  const tokenStore = createClickUpTokenStore({
    resolveConnection: async (connectionId) => getIntegrationConnectionById(connectionId),
    secrets,
  });

  const integrationProvider = createClickUpIntegrationProvider({
    agentTools: {
      clickup: createClickUpAgentToolsClient(),
      tokenStore,
    },
    clickup,
    routes: {
      tokenStore,
      getExistingClickUpConnection,
      connectClickUpInstallation,
      disconnectClickUpInstallation,
      updateClickUpInstallationWebhook,
      markConnectionActive: async ({connectionId}) => {
        const updated = await updateIntegrationConnectionLifecycleStatus({
          id: connectionId,
          lifecycleStatus: 'active',
          capabilities: providerCapabilities,
        });
        if (!updated) throw new Error('ClickUp connection disappeared during activation');
        return updated as CoreIntegrationConnection<'clickup'>;
      },
      markConnectionError: async ({connectionId}) => {
        await updateIntegrationConnectionLifecycleStatus({
          id: connectionId,
          lifecycleStatus: 'error',
        });
      },
      webhookUrlForConnection: clickupWebhookUrl,
      withClickUpInstallationLock,
      ...(options.requireActiveWorkspaceMembership
        ? {requireActiveWorkspaceMembership: options.requireActiveWorkspaceMembership}
        : {}),
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly,
      getIntegrationConnectionById,
      getClickUpInstallationByConnectionId,
      getWebhookSecret: (connectionId) => tokenStore.getWebhookSecret({connectionId}),
    },
    cleanup: {
      deleteConnectionRemoteResources: async (connection) => {
        const installation = await getClickUpInstallationByConnectionId(connection.id);
        const webhookId = installation?.webhookId;
        if (!webhookId) return undefined;
        let accessToken: string;
        try {
          accessToken = await tokenStore.getAccessToken({connectionId: connection.id});
        } catch (error) {
          logger().warn(
            {err: error, connectionId: connection.id, webhookId},
            'ClickUp webhook deletion could not read the access token',
          );
          return undefined;
        }
        return async (): Promise<void> => {
          try {
            await clickup.deleteWebhook({accessToken, webhookId});
          } catch (error) {
            logger().warn(
              {err: error, connectionId: connection.id, webhookId},
              'ClickUp webhook deletion failed during connection deletion',
            );
          }
        };
      },
      withConnectionDeletionLock: async (connection, fn) => {
        const installation = await getClickUpInstallationByConnectionId(connection.id);
        if (!installation) {
          await fn();
          return;
        }
        await withClickUpInstallationLock(installation.teamId, fn);
      },
      deleteConnectionRecords: async (connection, {tx}) => {
        await deleteClickUpInstallationByConnectionId(connection.id, {tx});
      },
      deleteConnectionSecrets: async (connection) => {
        await (options.secrets?.clickup?.deleteSecrets({
          workspaceId: connection.workspaceId,
          namespace: clickupNamespaceSuffix(clickupSecretsNamespace(connection.id)),
        }) ?? Promise.resolve(0));
      },
    },
  });
  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    e2eRoutes: [
      createClickUpE2eRoutes({
        tokenStore,
        getExistingClickUpConnection,
        connectClickUpInstallation,
        disconnectClickUpInstallation,
        connectionCapabilities: providerCapabilities,
      }),
    ],
    webhookProcessors: integrationProvider.webhookProcessors,
    database: {
      db: clickupDb,
      migrationsPath: clickupMigrationsPath,
      databaseNamespace: 'integrations_clickup',
    },
  };
}

export const clickupProviderModule: IntegrationProviderModule = {
  id: 'clickup',
  enabled: config.INTEGRATIONS_ENABLE_CLICKUP_PROVIDER,
  load: loadClickUpModuleParts,
};

export function clickupNamespaceSuffix(namespace: string): string {
  if (!namespace.startsWith(CLICKUP_SECRETS_NAMESPACE_PREFIX)) {
    throw new Error('ClickUp provider attempted to access an unscoped secret namespace');
  }
  return namespace.slice(CLICKUP_SECRETS_NAMESPACE_PREFIX.length);
}
