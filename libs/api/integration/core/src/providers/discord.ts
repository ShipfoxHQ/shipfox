import type {ConnectDiscordInstallationInput} from '@shipfox/api-integration-discord';
import type {IntegrationConnection as CoreIntegrationConnection} from '@shipfox/api-integration-spi';
import {config} from '#config.js';
import {
  getIntegrationConnectionById,
  resolveUniqueConnectionSlug,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {retryConnectionSlugCollision, slugifyConnectionSlug} from '#providers/connection-slug.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

async function loadDiscordModuleParts(
  _options: Parameters<IntegrationProviderModule['load']>[0] = {},
): Promise<IntegrationModuleParts> {
  const {
    config: discordConfig,
    createDiscordE2eRoutes,
    createDiscordGatewayService,
    createDiscordIntegrationProvider,
    deleteDiscordInstallationByConnectionId,
    db: discordDb,
    getDiscordInstallationByConnectionId,
    getDiscordInstallationByGuildId,
    migrationsPath: discordMigrationsPath,
    upsertDiscordInstallation,
  } = await import('@shipfox/api-integration-discord');

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
  });

  return {
    provider: integrationProvider,
    e2eRoutes: [
      createDiscordE2eRoutes({
        getExistingDiscordConnection,
        connectDiscordInstallation,
        connectionCapabilities: [],
      }),
    ],
    services: discordConfig.DISCORD_GATEWAY_ENABLED ? [createDiscordGatewayService()] : undefined,
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
