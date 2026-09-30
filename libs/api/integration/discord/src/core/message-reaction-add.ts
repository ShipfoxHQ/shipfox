import {
  DISCORD_MESSAGE_REACTION_ADD_EVENT,
  DISCORD_PROVIDER,
  discordMessageReactionAddPayloadSchema,
} from '@shipfox/api-integration-discord-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {getDiscordInstallationByGuildId} from '#db/installations.js';
import type {ChannelPlacement} from './channel-cache.js';
import {
  type DiscordMessageHandlerOptions,
  type DiscordMessageOutcome,
  rootChannel,
} from './message-create.js';

const reactionSchema = z
  .object({
    user_id: z.string().min(1),
    channel_id: z.string().min(1),
    message_id: z.string().min(1),
    guild_id: z.string().min(1).optional(),
    member: z
      .object({user: z.object({bot: z.boolean().optional()}).passthrough()})
      .passthrough()
      .optional(),
  })
  .passthrough();
type GatewayReaction = z.infer<typeof reactionSchema>;

/**
 * Publishes one `MESSAGE_REACTION_ADD` dispatch. The delivery id is `<session_id>:<sequence>`,
 * which is the same across resume replays of one session. A reaction has no id of its own, and a
 * `(message, user, emoji)` key would drop a reaction removed and added again within the retention
 * window. Two overlapping leaders run different sessions, so a rare duplicate gets through.
 * A failure to publish throws, so the caller keeps the committed mark below this dispatch.
 */
export async function handleDiscordReactionAdd(
  options: DiscordMessageHandlerOptions,
  dispatch: {data: unknown; sessionId: string | null; sequence: number},
): Promise<DiscordMessageOutcome> {
  const parsed = reactionSchema.safeParse(dispatch.data);
  if (!parsed.success) {
    logger().warn({issues: parsed.error.issues}, 'discord reaction failed schema validation');
    return 'ignored';
  }
  const reaction = parsed.data;
  const guildId = reaction.guild_id;
  if (!guildId) return 'ignored';
  // A dispatch always arrives on a session. Throwing keeps the mark below it instead of
  // publishing under an id that could collide.
  if (!dispatch.sessionId) throw new Error('discord reaction dispatched without a session id');

  const installation = await getDiscordInstallationByGuildId(guildId);
  if (installation?.status !== 'installed') return unavailable(reaction, guildId);

  // Resolved before the transaction: a REST call must not hold a database connection.
  const placement = await options.channels.resolve(reaction.channel_id);
  const payload = discordMessageReactionAddPayloadSchema.safeParse(
    normalizeReactionAdd({reaction, guildId, placement}),
  );
  if (!payload.success) {
    logger().warn({issues: payload.error.issues}, 'discord reaction payload is not publishable');
    return 'ignored';
  }

  return await options.coreDb().transaction(async (tx) => {
    const connection = await options.getIntegrationConnectionById(installation.connectionId, {tx});
    if (connection?.lifecycleStatus !== 'active') return unavailable(reaction, guildId);

    const result = await options.publishIntegrationEventReceived({
      tx,
      event: {
        provider: DISCORD_PROVIDER,
        source: connection.slug,
        event: DISCORD_MESSAGE_REACTION_ADD_EVENT,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId: `${dispatch.sessionId}:${dispatch.sequence}`,
        receivedAt: new Date().toISOString(),
        payload: payload.data,
      },
    });
    return result.published ? 'processed' : 'duplicate';
  });
}

function unavailable(reaction: GatewayReaction, guildId: string): DiscordMessageOutcome {
  logger().info(
    {messageId: reaction.message_id, guildId},
    'discord reaction: connection unavailable, dropping',
  );
  return 'connection_unavailable';
}

/** Adds the Shipfox fields to Discord's reaction payload. */
export function normalizeReactionAdd(params: {
  reaction: GatewayReaction;
  guildId: string;
  placement: ChannelPlacement | undefined;
}): Record<string, unknown> {
  const {reaction, guildId, placement} = params;
  const {member} = reaction;
  // Discord omits `bot` for humans, and `bot: undefined` would make a filter need `has()`.
  const normalizedMember = member && {
    ...member,
    user: {...member.user, bot: member.user.bot === true},
  };

  return {
    ...reaction,
    ...(normalizedMember ? {member: normalizedMember} : {}),
    ...rootChannel({channelId: reaction.channel_id, placement}),
    url: `https://discord.com/channels/${guildId}/${reaction.channel_id}/${reaction.message_id}`,
  };
}
