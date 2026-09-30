import {DISCORD_PROVIDER, discordEventCatalog} from '@shipfox/api-integration-discord-dto';
import type {RouteGroup} from '@shipfox/node-fastify';
import {discordConnectionExternalUrl} from '#core/connection-url.js';
import {createDiscordWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {type DiscordInstallation, getDiscordInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateDiscordWebhookRoutesOptions,
  createDiscordWebhookRoutes,
} from '#presentation/routes/webhooks.js';

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
  createDiscordGatewayService,
  type DiscordGatewayServiceOptions,
  GATEWAY_LOCK_KEY,
  type GatewayLostReason,
} from '#core/gateway-service.js';
export type {ConnectDiscordInstallationInput} from '#core/install.js';
export type {
  DiscordCommand,
  DiscordCommandOutcome,
  DiscordCommandResult,
  DiscordInteractionResponse,
  HandleDiscordCommandParams,
} from '#core/interactions.js';
export {
  DISCORD_ACK_CANNOT_POST,
  DISCORD_ACK_NOT_CONNECTED,
  DISCORD_ACK_UNSUPPORTED,
  DISCORD_ACK_WORKING,
  handleDiscordCommand,
} from '#core/interactions.js';
export type {VerifyDiscordSignatureParams} from '#core/signature.js';
export {
  DISCORD_FRESHNESS_WINDOW_MS,
  isDiscordTimestampFresh,
  verifyDiscordSignature,
} from '#core/signature.js';
export type {
  CreateDiscordWebhookProcessorOptions,
  DiscordInteractionProcessingResult,
  DiscordWebhookProcessor,
} from '#core/webhook-processor.js';
export {createDiscordWebhookProcessor} from '#core/webhook-processor.js';
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
export {
  type CreateDiscordWebhookRoutesOptions,
  createDiscordWebhookRoutes,
} from '#presentation/routes/webhooks.js';
export {closeDb, db, migrationsPath};

export interface CreateDiscordIntegrationProviderOptions {
  getDiscordInstallationByConnectionId?: (
    connectionId: string,
  ) => Promise<DiscordInstallation | undefined>;
  cleanup?: {
    deleteConnectionRecords?: (connection: {id: string}, options: {tx: unknown}) => Promise<void>;
  };
  routes?: CreateDiscordWebhookRoutesOptions | undefined;
}

export function createDiscordIntegrationProvider(
  options: CreateDiscordIntegrationProviderOptions = {},
) {
  const getInstallationByConnectionId =
    options.getDiscordInstallationByConnectionId ?? getDiscordInstallationByConnectionId;
  const webhookRoutes = options.routes;
  const webhookProcessor = webhookRoutes
    ? (webhookRoutes.processor ?? createDiscordWebhookProcessor(webhookRoutes))
    : undefined;
  const routes: RouteGroup[] =
    webhookRoutes && webhookProcessor
      ? [createDiscordWebhookRoutes({...webhookRoutes, processor: webhookProcessor})]
      : [];

  return {
    provider: DISCORD_PROVIDER,
    displayName: 'Discord',
    eventCatalog: discordEventCatalog,
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      return installation ? discordConnectionExternalUrl(installation.guildId) : undefined;
    },
    adapters: {},
    ...options.cleanup,
    routes,
    webhookProcessors: webhookProcessor
      ? [{routeIds: ['discord.interaction'] as const, processor: webhookProcessor}]
      : undefined,
  };
}
