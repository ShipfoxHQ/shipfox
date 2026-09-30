import type {ConnectDiscordInstallationInput} from '@shipfox/api-integration-discord';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import type {IntegrationCapability} from '#core/entities/provider.js';
import {getIntegrationProviderCapabilities} from '#core/providers/registry.js';
import {
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {publishIntegrationEventReceived, recordDeliveryOnly} from '#db/webhook-deliveries.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

async function loadDiscordModuleParts(
  options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    config: discordConfig,
    createDiscordE2eRoutes,
    createDiscordGateway,
    createDiscordGatewayHandlers,
    createDiscordIntegrationProvider,
    deleteDiscordInstallationByConnectionId,
    db: discordDb,
    getDiscordInstallationByConnectionId,
    getDiscordInstallationByGuildId,
    migrationsPath: discordMigrationsPath,
    registerDiscordCommands,
    upsertDiscordInstallation,
  } = await import('@shipfox/api-integration-discord');
  let providerCapabilities: IntegrationCapability[] = [];

  async function getExistingDiscordConnection(input: {
    guildId: string;
  }): Promise<CoreIntegrationConnection<'discord'> | undefined> {
    const installation = await getDiscordInstallationByGuildId(input.guildId);
    if (!installation) return undefined;
    const connection = await getIntegrationConnectionById(installation.connectionId);
    return connection as CoreIntegrationConnection<'discord'> | undefined;
  }

  async function connectDiscordInstallation(
    input: ConnectDiscordInstallationInput,
  ): Promise<CoreIntegrationConnection<'discord'>> {
    return await retryConnectionSlugCollision(() =>
      db().transaction(async (tx) => {
        const slug = await resolveUniqueConnectionSlug(
          {
            workspaceId: input.workspaceId,
            provider: 'discord',
            externalAccountId: input.guildId,
            baseSlug: slugifyConnectionSlug(`discord_${input.guildName || input.guildId}`, {
              fallback: 'discord',
            }),
          },
          {tx},
        );
        const connection = await upsertIntegrationConnection(
          {
            workspaceId: input.workspaceId,
            provider: 'discord',
            externalAccountId: input.guildId,
            slug,
            displayName: input.displayName ?? input.guildName,
            lifecycleStatus: input.lifecycleStatus ?? 'error',
            capabilities: providerCapabilities,
          },
          {tx},
        );
        await upsertDiscordInstallation(
          {
            connectionId: connection.id,
            guildId: input.guildId,
            guildName: input.guildName,
            permissions: input.permissions,
            installedByDiscordUserId: input.installedByDiscordUserId,
            botRoleId: input.botRoleId,
            status: 'installed',
          },
          {tx},
        );
        return connection as CoreIntegrationConnection<'discord'>;
      }),
    );
  }

  const integrationProvider = createDiscordIntegrationProvider({
    getDiscordInstallationByConnectionId,
    cleanup: {
      deleteConnectionRecords: async (connection, {tx}) => {
        await deleteDiscordInstallationByConnectionId(connection.id, {tx});
      },
    },
    routes: {
      coreDb: db,
      publishIntegrationEventReceived,
      recordDeliveryOnly,
      getIntegrationConnectionById,
    },
    install: {
      getExistingDiscordConnection,
      connectDiscordInstallation,
      connectionCapabilities: [],
      ...(options.requireActiveWorkspaceMembership
        ? {requireActiveWorkspaceMembership: options.requireActiveWorkspaceMembership}
        : {}),
    },
  });

  providerCapabilities = getIntegrationProviderCapabilities(integrationProvider.adapters);

  return {
    provider: integrationProvider,
    webhookProcessors: integrationProvider.webhookProcessors,
    e2eRoutes: [
      createDiscordE2eRoutes({
        getExistingDiscordConnection,
        connectDiscordInstallation,
        connectionCapabilities: providerCapabilities,
      }),
    ],
    startupTasks: [async () => void (await registerDiscordCommands())],
    services: discordConfig.DISCORD_GATEWAY_ENABLED
      ? [
          createDiscordGateway({
            handlers: createDiscordGatewayHandlers({
              coreDb: db,
              publishIntegrationEventReceived,
              getIntegrationConnectionById,
            }),
          }),
        ]
      : undefined,
    database: {
      db: discordDb,
      migrationsPath: discordMigrationsPath,
      databaseNamespace: 'integrations_discord',
    },
  };
}

export const discordProviderModule: IntegrationProviderModule = {
  id: 'discord',
  enabled: config.INTEGRATIONS_ENABLE_DISCORD_PROVIDER,
  load: loadDiscordModuleParts,
};
