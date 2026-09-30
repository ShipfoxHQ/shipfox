import {
  DISCORD_MESSAGE_CREATE_EVENT,
  DISCORD_PROVIDER,
  discordMessageCreatePayloadSchema,
} from '@shipfox/api-integration-discord-dto';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {z} from 'zod';
import {config} from '#config.js';
import {getDiscordInstallationByGuildId} from '#db/installations.js';
import type {ChannelPlacement, DiscordChannelCache} from './channel-cache.js';

export interface DiscordMessageHandlerOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  channels: DiscordChannelCache;
  /** The bot user id, which equals the application id. Defaults to `DISCORD_APPLICATION_ID`. */
  botUserId?: string | undefined;
}

/** `ignored` covers what never belongs to a connection: a DM, or a message that is not a message. */
export type DiscordMessageOutcome =
  | 'processed'
  | 'duplicate'
  | 'connection_unavailable'
  | 'ignored';

const messageSchema = z
  .object({
    id: z.string().min(1),
    channel_id: z.string().min(1),
    guild_id: z.string().min(1).optional(),
    author: z.object({}).passthrough(),
    mentions: z.array(z.object({id: z.string()}).passthrough()).default([]),
    mention_roles: z.array(z.string()).default([]),
  })
  .passthrough();
type GatewayMessage = z.infer<typeof messageSchema>;

/**
 * Publishes one `MESSAGE_CREATE` dispatch. The message id is the delivery id: it is the same across
 * resume replays, duplicate sessions, and overlapping leaders, so each message publishes once.
 * A failure to publish throws, so the caller keeps the committed mark below this dispatch.
 */
export async function handleDiscordMessageCreate(
  options: DiscordMessageHandlerOptions,
  data: unknown,
): Promise<DiscordMessageOutcome> {
  const parsed = messageSchema.safeParse(data);
  if (!parsed.success) {
    logger().warn({issues: parsed.error.issues}, 'discord message failed schema validation');
    return 'ignored';
  }
  const message = parsed.data;
  const guildId = message.guild_id;
  if (!guildId) return 'ignored';

  const installation = await getDiscordInstallationByGuildId(guildId);
  if (installation?.status !== 'installed') return unavailable(message, guildId);

  // Resolved before the transaction: a REST call must not hold a database connection.
  const placement = await options.channels.resolve(message.channel_id);
  const payload = discordMessageCreatePayloadSchema.safeParse(
    normalizeMessageCreate({
      message,
      guildId,
      placement,
      botUserId: options.botUserId ?? config.DISCORD_APPLICATION_ID,
      botRoleId: installation.botRoleId,
    }),
  );
  if (!payload.success) {
    logger().warn({issues: payload.error.issues}, 'discord message payload is not publishable');
    return 'ignored';
  }

  return await options.coreDb().transaction(async (tx) => {
    const connection = await options.getIntegrationConnectionById(installation.connectionId, {tx});
    if (connection?.lifecycleStatus !== 'active') return unavailable(message, guildId);

    const result = await options.publishIntegrationEventReceived({
      tx,
      event: {
        provider: DISCORD_PROVIDER,
        source: connection.slug,
        event: DISCORD_MESSAGE_CREATE_EVENT,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId: message.id,
        receivedAt: new Date().toISOString(),
        payload: payload.data,
      },
    });
    return result.published ? 'processed' : 'duplicate';
  });
}

function unavailable(message: GatewayMessage, guildId: string): DiscordMessageOutcome {
  logger().info(
    {messageId: message.id, guildId},
    'discord message: connection unavailable, dropping',
  );
  return 'connection_unavailable';
}

/** Adds the Shipfox fields to Discord's message object. */
export function normalizeMessageCreate(params: {
  message: GatewayMessage;
  guildId: string;
  placement: ChannelPlacement | undefined;
  botUserId: string;
  botRoleId: string | null;
}): Record<string, unknown> {
  const {message, guildId, placement, botUserId, botRoleId} = params;
  const mentionsBot =
    message.mentions.some((user) => user.id === botUserId) ||
    (botRoleId !== null && message.mention_roles.includes(botRoleId));
  // Discord omits `bot` for humans, and `bot: undefined` would make a filter need `has()`.
  const author = {...message.author, bot: message.author.bot === true};

  return {
    ...message,
    author,
    mentions_bot: mentionsBot,
    ...(placement?.isThread ? {thread_id: message.channel_id} : {}),
    ...rootChannel({channelId: message.channel_id, placement}),
    url: `https://discord.com/channels/${guildId}/${message.channel_id}/${message.id}`,
  };
}

/** A thread message lives in its parent, so a thread whose parent is unknown has no root. */
export function rootChannel(params: {channelId: string; placement: ChannelPlacement | undefined}) {
  const {channelId, placement} = params;
  if (!placement) return {};
  if (!placement.isThread) return {root_channel_id: channelId};
  return placement.parentId ? {root_channel_id: placement.parentId} : {};
}
