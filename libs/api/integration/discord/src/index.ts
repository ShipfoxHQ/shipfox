import {DISCORD_PROVIDER, discordEventCatalog} from '@shipfox/api-integration-discord-dto';
import type {RouteGroup} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {createDiscordApiClient, type DiscordApiClient} from '#api/client.js';
import {DiscordAgentToolsProvider} from '#core/agent-tools-provider.js';
import {discordConnectionExternalUrl} from '#core/connection-url.js';
import {DiscordIntegrationProviderError} from '#core/errors.js';
import {createDiscordWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {withDiscordGuildLock} from '#db/guild-lock.js';
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
  DiscordMessage,
  DiscordRole,
} from '#api/client.js';
export {createDiscordApiClient, DISCORD_API_TIMEOUT_MS} from '#api/client.js';
export {config} from '#config.js';
export {
  DiscordAgentToolsProvider,
  type DiscordAgentToolsProviderOptions,
  type DiscordToolCallResult,
} from '#core/agent-tools-provider.js';
export type {
  RegisterDiscordCommandsOptions,
  RegisterDiscordCommandsResult,
} from '#core/command-registration.js';
export {discordCommandsMatch, registerDiscordCommands} from '#core/command-registration.js';
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
export {discordGuildLockKey, withDiscordGuildLock} from '#db/guild-lock.js';
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
  discord?: DiscordApiClient | undefined;
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
  const discord = options.discord ?? createDiscordApiClient();
  const agentTools = new DiscordAgentToolsProvider({discord, getInstallationByConnectionId});
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
    adapters: {agent_tools: agentTools},
    /**
     * Leaving the guild runs after the records commit, so the guild lock has to cover both. Without
     * it a reinstall could commit in between and the delayed leave would remove the new bot.
     */
    async withConnectionDeletionLock(connection: {id: string}, fn: () => Promise<void>) {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation) {
        await fn();
        return;
      }
      await withDiscordGuildLock(installation.guildId, fn);
    },
    async deleteConnectionRemoteResources(connection: {
      id: string;
    }): Promise<(() => Promise<void>) | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation) return undefined;
      const {guildId} = installation;
      return async () => {
        try {
          await discord.leaveGuild({guildId});
        } catch (error) {
          // 403 and 404 both mean the bot is already out of the guild.
          if (
            error instanceof DiscordIntegrationProviderError &&
            (error.status === 403 || error.status === 404)
          ) {
            return;
          }
          logger().warn(
            {err: error, connectionId: connection.id, guildId},
            'Discord guild leave failed during connection deletion',
          );
        }
      };
    },
    ...options.cleanup,
    routes,
    webhookProcessors: webhookProcessor
      ? [{routeIds: ['discord.interaction'] as const, processor: webhookProcessor}]
      : undefined,
  };
}
