import {
  DISCORD_MESSAGE_COMMAND,
  DISCORD_MESSAGE_COMMAND_EVENT,
  DISCORD_PROVIDER,
  DISCORD_SLASH_COMMAND,
  DISCORD_SLASH_COMMAND_EVENT,
  type DiscordInteractionEnvelopeDto,
  discordMessageCommandPayloadSchema,
  discordSlashCommandPayloadSchema,
} from '@shipfox/api-integration-discord-dto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import {z} from 'zod';
import {type DiscordInstallation, getDiscordInstallationByGuildId} from '#db/installations.js';

export const DISCORD_ACK_NOT_CONNECTED = 'This server is not connected to Shipfox.';
export const DISCORD_ACK_CANNOT_POST =
  'Shipfox got your request, but it cannot post in this channel. Replies may not appear.';
export const DISCORD_ACK_WORKING = 'Working on it.';
export const DISCORD_ACK_UNSUPPORTED = 'This action is not supported.';

const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const SEND_MESSAGES_IN_THREADS = 1n << 38n;
const EPHEMERAL_FLAG = 64;
const decimalPattern = /^\d+$/;
const THREAD_CHANNEL_TYPES = new Set([10, 11, 12]);

export type DiscordInteractionResponse =
  | {type: 1}
  | {type: 4; data: {content: string; flags: typeof EPHEMERAL_FLAG}};

export const DISCORD_PONG: DiscordInteractionResponse = {type: 1};

export function discordEphemeralMessage(content: string): DiscordInteractionResponse {
  return {type: 4, data: {content, flags: EPHEMERAL_FLAG}};
}

export type DiscordCommandOutcome = 'published' | 'duplicate' | 'connection-unavailable';

export interface DiscordCommandResult {
  outcome: DiscordCommandOutcome | 'unsupported-command';
  response: DiscordInteractionResponse;
}

export interface HandleDiscordCommandParams {
  tx: IntegrationTx;
  interaction: DiscordInteractionEnvelopeDto;
  command: DiscordCommand;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

const commandDataSchema = z
  .object({
    name: z.string(),
    type: z.number().int().optional(),
    options: z
      .array(z.object({name: z.string(), value: z.unknown().optional()}).passthrough())
      .optional(),
    target_id: z.string().optional(),
    resolved: z
      .object({messages: z.record(z.string(), z.record(z.string(), z.unknown())).optional()})
      .passthrough()
      .optional(),
  })
  .passthrough();
type CommandData = z.infer<typeof commandDataSchema>;

export type DiscordCommand =
  | {kind: 'slash'; data: CommandData}
  | {kind: 'message'; data: CommandData};

/** Interactions that are not the two Shipfox application commands have no handler. */
export function classifyDiscordCommand(
  interaction: DiscordInteractionEnvelopeDto,
): DiscordCommand | null {
  if (interaction.type !== 2) return null;
  const data = commandDataSchema.safeParse(interaction.data);
  if (!data.success) return null;
  if (
    data.data.name === DISCORD_SLASH_COMMAND.name &&
    data.data.type === DISCORD_SLASH_COMMAND.type
  ) {
    return {kind: 'slash', data: data.data};
  }
  if (
    data.data.name === DISCORD_MESSAGE_COMMAND.name &&
    data.data.type === DISCORD_MESSAGE_COMMAND.type
  ) {
    return {kind: 'message', data: data.data};
  }
  return null;
}

export async function handleDiscordCommand(
  params: HandleDiscordCommandParams,
): Promise<DiscordCommandResult> {
  const {tx, interaction, command} = params;
  const guildId = interaction.guild_id;
  if (!guildId) {
    logger().info({deliveryId: interaction.id}, 'discord interaction: no guild, dropping');
    return unsupported();
  }

  const installation = await getDiscordInstallationByGuildId(guildId, {tx});
  const connection =
    installation?.status === 'installed'
      ? await params.getIntegrationConnectionById(installation.connectionId, {tx})
      : undefined;
  if (!installation || !connection || connection.lifecycleStatus !== 'active') {
    logger().info(
      {deliveryId: interaction.id, guildId, connectionId: installation?.connectionId},
      'discord interaction: connection unavailable, dropping',
    );
    await params.recordDeliveryOnly({tx, provider: DISCORD_PROVIDER, deliveryId: interaction.id});
    return {
      outcome: 'connection-unavailable',
      response: discordEphemeralMessage(DISCORD_ACK_NOT_CONNECTED),
    };
  }

  const event = buildCommandEvent(interaction, command, installation);
  if (!event) return unsupported();

  const result = await params.publishIntegrationEventReceived({
    tx,
    event: {
      provider: DISCORD_PROVIDER,
      source: connection.slug,
      event: event.name,
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      connectionName: connection.displayName,
      deliveryId: interaction.id,
      receivedAt: new Date().toISOString(),
      payload: event.payload,
    },
  });

  return {
    outcome: result.published ? 'published' : 'duplicate',
    response: discordEphemeralMessage(
      canPostInChannel(interaction) ? DISCORD_ACK_WORKING : DISCORD_ACK_CANNOT_POST,
    ),
  };
}

function unsupported(): DiscordCommandResult {
  return {
    outcome: 'unsupported-command',
    response: discordEphemeralMessage(DISCORD_ACK_UNSUPPORTED),
  };
}

function canPostInChannel(interaction: DiscordInteractionEnvelopeDto): boolean {
  const appPermissions = interaction.app_permissions;
  if (!appPermissions || !decimalPattern.test(appPermissions)) return false;
  const permissions = BigInt(appPermissions);
  // Threads have their own send permission, so SEND_MESSAGES alone does not let the bot reply there.
  const sendPermission = channelPlacement(interaction).threadId
    ? SEND_MESSAGES_IN_THREADS
    : SEND_MESSAGES;
  return (permissions & VIEW_CHANNEL) !== 0n && (permissions & sendPermission) !== 0n;
}

function buildCommandEvent(
  interaction: DiscordInteractionEnvelopeDto,
  command: DiscordCommand,
  installation: DiscordInstallation,
): {name: string; payload: Record<string, unknown>} | null {
  const author = normalizeUser(asRecord(asRecord(interaction.member)?.user));
  if (!author) return null;
  const channel = channelPlacement(interaction);

  if (command.kind === 'slash') {
    const prompt = command.data.options?.find((option) => option.name === 'prompt')?.value;
    if (typeof prompt !== 'string') return null;
    const payload = discordSlashCommandPayloadSchema.safeParse({
      ...interaction,
      author,
      prompt,
      ...(channel.rootChannelId ? {root_channel_id: channel.rootChannelId} : {}),
    });
    return payload.success ? {name: DISCORD_SLASH_COMMAND_EVENT, payload: payload.data} : null;
  }

  const targetId = command.data.target_id;
  const target = targetId ? command.data.resolved?.messages?.[targetId] : undefined;
  const targetMessage = target && normalizeMessage({message: target, interaction, installation});
  if (!targetMessage) return null;
  const payload = discordMessageCommandPayloadSchema.safeParse({
    ...interaction,
    author,
    target_message: targetMessage,
    ...(channel.rootChannelId ? {root_channel_id: channel.rootChannelId} : {}),
  });
  return payload.success ? {name: DISCORD_MESSAGE_COMMAND_EVENT, payload: payload.data} : null;
}

function channelPlacement(interaction: DiscordInteractionEnvelopeDto): {
  threadId?: string;
  rootChannelId?: string;
} {
  const channel = asRecord(interaction.channel);
  const channelId = interaction.channel_id;
  const parentId = typeof channel?.parent_id === 'string' ? channel.parent_id : undefined;
  const isThread = typeof channel?.type === 'number' && THREAD_CHANNEL_TYPES.has(channel.type);
  if (isThread && channelId) {
    return {threadId: channelId, ...(parentId ? {rootChannelId: parentId} : {})};
  }
  return channelId ? {rootChannelId: channelId} : {};
}

function normalizeMessage(params: {
  message: Record<string, unknown>;
  interaction: DiscordInteractionEnvelopeDto;
  installation: DiscordInstallation;
}): Record<string, unknown> | null {
  const {message, interaction, installation} = params;
  const author = normalizeUser(asRecord(message.author));
  const id = message.id;
  const channelId = message.channel_id;
  if (!author || typeof id !== 'string' || typeof channelId !== 'string') return null;

  // The target message lives in the channel the command was invoked from.
  const placement = channelPlacement(interaction);
  const sameChannel = channelId === interaction.channel_id;
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  const mentionRoles = Array.isArray(message.mention_roles) ? message.mention_roles : [];
  const mentionsBot =
    mentions.some((mention) => asRecord(mention)?.id === interaction.application_id) ||
    (installation.botRoleId !== null && mentionRoles.includes(installation.botRoleId));

  return {
    ...message,
    ...(interaction.guild_id ? {guild_id: interaction.guild_id} : {}),
    author,
    mentions_bot: mentionsBot,
    ...(sameChannel && placement.threadId ? {thread_id: placement.threadId} : {}),
    ...(sameChannel && placement.rootChannelId ? {root_channel_id: placement.rootChannelId} : {}),
    url: `https://discord.com/channels/${interaction.guild_id}/${channelId}/${id}`,
  };
}

function normalizeUser(user: Record<string, unknown> | undefined) {
  if (!user) return null;
  return {...user, bot: user.bot === true};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
