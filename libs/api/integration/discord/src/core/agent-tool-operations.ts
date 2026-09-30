import type {DiscordAgentToolId} from '@shipfox/api-integration-discord-dto';
import type {DiscordApiClient, DiscordChannel, DiscordMessage} from '#api/client.js';
import type {DiscordChannelGuard} from '#core/channel-guard.js';
import {isDiscordThreadType} from '#core/channel-types.js';
import {DiscordIntegrationProviderError, DiscordToolArgumentError} from '#core/errors.js';
import {splitDiscordMessage} from '#core/message-split.js';
import {ensureMessageThread} from '#core/message-thread.js';

export type DiscordToolClient = Pick<
  DiscordApiClient,
  | 'getChannel'
  | 'getMessage'
  | 'listChannelMessages'
  | 'listGuildChannels'
  | 'listActiveGuildThreads'
  | 'searchGuildMessages'
  | 'getGuildMember'
  | 'createMessage'
  | 'startThreadFromMessage'
>;

const DEFAULT_THREAD_LIMIT = 50;

export interface DiscordToolContext {
  discord: DiscordToolClient;
  guildId: string;
  guard: DiscordChannelGuard;
}

export interface DiscordToolOperation {
  /** Named in the answer to a `403`, so an admin knows what to grant the bot in the channel. */
  permissionHint?: string;
  /** Rules a JSON Schema cannot express. Returns the message for the agent. */
  validate?(args: Record<string, unknown>): string | undefined;
  run(args: Record<string, unknown>, context: DiscordToolContext): Promise<Record<string, unknown>>;
}

export const DISCORD_TOOL_OPERATIONS: Partial<Record<DiscordAgentToolId, DiscordToolOperation>> = {
  read_channel: {
    permissionHint: 'View Channel and Read Message History',
    validate: (args) =>
      args.before !== undefined && args.after !== undefined
        ? 'Parameters before and after cannot be used together'
        : undefined,
    async run(args, {discord, guildId, guard}) {
      const channelId = stringArgument(args, 'channel_id');
      await guard({channelId, guildId});
      const messages = await discord.listChannelMessages({
        channelId,
        limit: optionalNumber(args.limit),
        before: optionalString(args.before),
        after: optionalString(args.after),
      });
      return {messages: messages.map((message) => withUrl(message, guildId))};
    },
  },
  read_thread: {
    permissionHint: 'View Channel and Read Message History',
    async run(args, {discord, guildId, guard}) {
      const channelId = stringArgument(args, 'channel_id');
      const limit = optionalNumber(args.limit) ?? DEFAULT_THREAD_LIMIT;
      const channel = await guard({channelId, guildId});

      if (isDiscordThreadType(channel.type)) {
        // A thread started from a message has that message's id and the message lives in the parent.
        const starter =
          channel.parentId === null
            ? undefined
            : await getMessageOrUndefined(discord, {
                channelId: channel.parentId,
                messageId: channelId,
              });
        return {
          messages: [
            ...(starter ? [starter] : []),
            ...(await listThreadMessages(discord, {threadId: channelId, limit})),
          ].map((message) => withUrl(message, guildId)),
        };
      }

      const messageId = optionalString(args.message_id);
      if (messageId === undefined) {
        throw new DiscordToolArgumentError('Parameter message_id is required in a channel');
      }
      // The message is read under the verified channel, so the thread it started is in this server.
      const message = await discord.getMessage({channelId, messageId});
      const thread = message.thread
        ? await listThreadMessages(discord, {threadId: message.thread.id, limit})
        : [];
      return {messages: [message, ...thread].map((entry) => withUrl(entry, guildId))};
    },
  },
  list_channels: {
    permissionHint: 'View Channels',
    async run(args, {discord, guildId}) {
      const [channels, threads] = await Promise.all([
        discord.listGuildChannels({guildId}),
        args.include_threads === true ? discord.listActiveGuildThreads({guildId}) : [],
      ]);
      const needle = optionalString(args.name_contains)?.toLowerCase();
      return {
        channels: [...channels, ...threads]
          .filter((channel) => needle === undefined || channel.name?.toLowerCase().includes(needle))
          .map(toChannelEntry),
      };
    },
  },
  search_messages: {
    permissionHint: 'View Channel and Read Message History',
    async run(args, {discord, guildId, guard}) {
      const channelId = optionalString(args.channel_id);
      if (channelId !== undefined) await guard({channelId, guildId});
      const result = await discord.searchGuildMessages({
        guildId,
        content: stringArgument(args, 'query'),
        channelId,
        authorId: optionalString(args.author_id),
        limit: optionalNumber(args.limit),
        offset: optionalNumber(args.offset),
      });
      return {
        total_results: result.total_results,
        messages: result.messages.flatMap((group) => {
          const hit = group.find((message) => message.hit === true);
          return hit ? [withUrl(hit, guildId)] : [];
        }),
      };
    },
  },
  read_user_profile: {
    async run(args, {discord, guildId}) {
      const member = await discord.getGuildMember({
        guildId,
        userId: stringArgument(args, 'user_id'),
      });
      return {
        id: member.user.id,
        username: member.user.username,
        global_name: member.user.global_name ?? null,
        nickname: member.nick ?? null,
        bot: member.user.bot === true,
        roles: member.roles,
        joined_at: member.joined_at,
      };
    },
  },
  send_message: {
    permissionHint:
      'View Channel, Read Message History, Send Messages, Send Messages in Threads, and Create Public Threads',
    validate: (args) =>
      stringArgument(args, 'message').trim() === ''
        ? 'Parameter message must not be empty'
        : undefined,
    async run(args, {discord, guildId, guard}) {
      const parts = splitDiscordMessage(stringArgument(args, 'message'));
      if (!parts) {
        throw new DiscordIntegrationProviderError({
          reason: 'content-too-large',
          message: 'The message is too long for Discord. Shorten it to under 10,000 characters.',
        });
      }
      const channelId = stringArgument(args, 'channel_id');
      const threadMessageId = optionalString(args.thread_message_id);
      const {type} = await guard({channelId, guildId});
      // In a thread, thread_message_id is ignored so one set of arguments serves both places.
      const startsThread = threadMessageId !== undefined && !isDiscordThreadType(type);
      const targetId = startsThread
        ? await ensureMessageThread({discord, channelId, messageId: threadMessageId})
        : channelId;
      // A reply must name a message in the channel it is posted to, and a new thread has none yet.
      const replyToMessageId = startsThread ? undefined : optionalString(args.reply_to_message_id);

      const posted: DiscordMessage[] = [];
      for (const [index, content] of parts.entries()) {
        posted.push(
          await discord.createMessage({
            channelId: targetId,
            content,
            replyToMessageId: index === 0 ? replyToMessageId : undefined,
          }),
        );
      }
      const messages = posted.map((message) => withUrl(message, guildId));
      const [first] = messages;
      return {id: first?.id, channel_id: targetId, url: first?.url, messages};
    },
  },
};

/** Discord answers newest first; a thread reads better oldest first. */
async function listThreadMessages(
  discord: DiscordToolClient,
  input: {threadId: string; limit: number},
): Promise<DiscordMessage[]> {
  const messages = await discord.listChannelMessages({
    channelId: input.threadId,
    limit: input.limit,
  });
  return messages.reverse();
}

/** A thread that did not start from a message, or whose starter was deleted, has none. */
async function getMessageOrUndefined(
  discord: DiscordToolClient,
  input: {channelId: string; messageId: string},
): Promise<DiscordMessage | undefined> {
  try {
    return await discord.getMessage(input);
  } catch (error) {
    if (error instanceof DiscordIntegrationProviderError && error.reason === 'not-found') {
      return undefined;
    }
    throw error;
  }
}

function withUrl(message: DiscordMessage, guildId: string): Record<string, unknown> {
  return {
    ...message,
    url: discordMessageUrl({guildId, channelId: message.channel_id, messageId: message.id}),
  };
}

function toChannelEntry(channel: DiscordChannel) {
  return {
    id: channel.id,
    name: channel.name ?? null,
    type: channel.type,
    parent_id: channel.parent_id ?? null,
    topic: channel.topic ?? null,
  };
}

export function discordMessageUrl(input: {
  guildId: string;
  channelId: string;
  messageId: string;
}): string {
  return `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;
}

function stringArgument(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === 'string' ? value : String(value ?? '');
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
