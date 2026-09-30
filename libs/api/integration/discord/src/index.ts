import {DISCORD_PROVIDER, discordEventCatalog} from '@shipfox/api-integration-discord-dto';
import {discordConnectionExternalUrl} from '#core/connection-url.js';
import {closeDb, db} from '#db/db.js';
import {type DiscordInstallation, getDiscordInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';

export type {DiscordProvider} from '@shipfox/api-integration-discord-dto';
export type {
  CreateDiscordApiClientOptions,
  DiscordApiClient,
  DiscordApplicationCommand,
  DiscordApplicationCommandDefinition,
  DiscordChannel,
  DiscordGatewayBot,
  DiscordGuild,
  DiscordRole,
} from '#api/client.js';
export {createDiscordApiClient, DISCORD_API_TIMEOUT_MS} from '#api/client.js';
export {config} from '#config.js';
export {discordConnectionExternalUrl} from '#core/connection-url.js';
export {DiscordIntegrationProviderError} from '#core/errors.js';
export {
  createDiscordGateway,
  type DiscordGatewayRunOptions,
  type DispatchHandler,
  type DispatchHandlers,
  type GatewayDispatchPayload,
} from '#core/gateway.js';
export {
  createDiscordGatewayService,
  type DiscordGatewayServiceOptions,
  GATEWAY_LOCK_KEY,
  type GatewayLostReason,
} from '#core/gateway-service.js';
export type {ConnectDiscordInstallationInput} from '#core/install.js';
export type {
  DiscordInstallation,
  DiscordInstallationStatus,
  UpsertDiscordInstallationParams,
} from '#db/installations.js';
export {
  DiscordConnectionAlreadyLinkedError,
  DiscordInstallationAlreadyLinkedError,
  deleteDiscordInstallationByConnectionId,
  getDiscordInstallationByConnectionId,
  getDiscordInstallationByGuildId,
  upsertDiscordInstallation,
} from '#db/installations.js';
export {
  type CreateE2eDiscordConnectionRouteOptions,
  createE2eDiscordConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
export {
  type CreateDiscordE2eRoutesOptions,
  createDiscordE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
export {closeDb, db, migrationsPath};

export interface CreateDiscordIntegrationProviderOptions {
  getDiscordInstallationByConnectionId?: (
    connectionId: string,
  ) => Promise<DiscordInstallation | undefined>;
  cleanup?: {
    deleteConnectionRecords?: (connection: {id: string}, options: {tx: unknown}) => Promise<void>;
  };
}

export function createDiscordIntegrationProvider(
  options: CreateDiscordIntegrationProviderOptions = {},
) {
  const getInstallationByConnectionId =
    options.getDiscordInstallationByConnectionId ?? getDiscordInstallationByConnectionId;

  return {
    provider: DISCORD_PROVIDER,
    displayName: 'Discord',
    eventCatalog: discordEventCatalog,
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      return installation ? discordConnectionExternalUrl(installation.guildId) : undefined;
    },
    adapters: {},
    routes: [],
    ...options.cleanup,
  };
}
