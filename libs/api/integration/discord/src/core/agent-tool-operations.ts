import type {DiscordAgentToolId} from '@shipfox/api-integration-discord-dto';
import type {DiscordApiClient, DiscordChannel, DiscordMessage} from '#api/client.js';
import type {DiscordChannelGuard} from '#core/channel-guard.js';
import {isDiscordForumType, isDiscordThreadType} from '#core/channel-types.js';
import {DiscordIntegrationProviderError, DiscordToolArgumentError} from '#core/errors.js';
import {DISCORD_MESSAGE_LIMIT, splitDiscordMessage} from '#core/message-split.js';
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
  | 'createThread'
  | 'editMessage'
  | 'addReaction'
>;

const DEFAULT_THREAD_LIMIT = 50;
const THREAD_NAME_MAX_LENGTH = 100;
const EMOJI_MAX_LENGTH = 64;
const CUSTOM_EMOJI_RE = /^\w{2,32}:\d{1,20}$/;
const WHITESPACE_RE = /\s/;
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u;

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
  create_thread: {
    permissionHint:
      'View Channel, Read Message History, and Create Public Threads, plus Send Messages in a forum or media channel',
    validate(args) {
      const length = Array.from(stringArgument(args, 'name').trim()).length;
      return length === 0 || length > THREAD_NAME_MAX_LENGTH
        ? `Parameter name must be 1 to ${THREAD_NAME_MAX_LENGTH} characters`
        : undefined;
    },
    async run(args, {discord, guildId, guard}) {
      const channelId = stringArgument(args, 'channel_id');
      const name = stringArgument(args, 'name').trim();
      const messageId = optionalString(args.message_id);
      const post = optionalString(args.message);
      const {type} = await guard({channelId, guildId});

      if (isDiscordThreadType(type)) {
        throw new DiscordToolArgumentError(
          'A thread cannot be created inside a thread. Use the channel the thread belongs to',
        );
      }
      let threadId: string;
      if (isDiscordForumType(type)) {
        if (messageId !== undefined) {
          throw new DiscordToolArgumentError(
            'Parameter message_id is not accepted in a forum or media channel',
          );
        }
        if (post === undefined) {
          throw new DiscordToolArgumentError(
            'Parameter message is required in a forum or media channel',
          );
        }
        threadId = (await discord.createThread({channelId, name, post: messageText(post)})).id;
      } else if (post !== undefined) {
        throw new DiscordToolArgumentError(
          'Parameter message is only accepted in a forum or media channel. Post in the thread with send_message',
        );
      } else if (messageId === undefined) {
        threadId = (await discord.createThread({channelId, name})).id;
      } else {
        threadId = await ensureMessageThread({discord, channelId, messageId, name});
      }
      return {
        id: threadId,
        channel_id: channelId,
        url: discordChannelUrl({guildId, channelId: threadId}),
      };
    },
  },
  update_message: {
    permissionHint: 'View Channel and Read Message History',
    validate: (args) =>
      stringArgument(args, 'message').trim() === ''
        ? 'Parameter message must not be empty'
        : undefined,
    async run(args, {discord, guildId, guard}) {
      const content = messageText(stringArgument(args, 'message'));
      const channelId = stringArgument(args, 'channel_id');
      await guard({channelId, guildId});
      const message = await discord.editMessage({
        channelId,
        messageId: stringArgument(args, 'message_id'),
        content,
      });
      return withUrl(message, guildId);
    },
  },
  add_reaction: {
    permissionHint: 'View Channel, Read Message History, and Add Reactions',
    validate(args) {
      const emoji = stringArgument(args, 'emoji');
      if (emoji.length > EMOJI_MAX_LENGTH || WHITESPACE_RE.test(emoji)) return INVALID_EMOJI;
      // A custom emoji is name:id. Anything else must be the emoji itself, not a :shortcode:.
      const valid = emoji.includes(':')
        ? CUSTOM_EMOJI_RE.test(emoji)
        : UNICODE_EMOJI_RE.test(emoji);
      return valid ? undefined : INVALID_EMOJI;
    },
    async run(args, {discord, guildId, guard}) {
      const channelId = stringArgument(args, 'channel_id');
      const messageId = stringArgument(args, 'message_id');
      const emoji = stringArgument(args, 'emoji');
      await guard({channelId, guildId});
      await discord.addReaction({channelId, messageId, emoji});
      return {
        channel_id: channelId,
        message_id: messageId,
        emoji,
        url: discordMessageUrl({guildId, channelId, messageId}),
      };
    },
  },
};

const INVALID_EMOJI =
  'Parameter emoji must be a Unicode emoji, or name:id for a custom emoji. Shortcodes such as :thumbsup: are not accepted';

/** One message, never split: a post or an edit has no continuation. */
function messageText(text: string): string {
  const content = text.trim();
  if (content === '') throw new DiscordToolArgumentError('The message must not be empty');
  if (content.length > DISCORD_MESSAGE_LIMIT) {
    throw new DiscordIntegrationProviderError({
      reason: 'content-too-large',
      message: `The message is too long for Discord. Shorten it to ${DISCORD_MESSAGE_LIMIT} characters or fewer.`,
    });
  }
  return content;
}

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

function discordChannelUrl(input: {guildId: string; channelId: string}): string {
  return `https://discord.com/channels/${input.guildId}/${input.channelId}`;
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
