import type {
  Interaction,
  InteractionProvider,
  InteractionRole,
  ReadInteractionInput,
} from '@shipfox/api-integration-spi';
import {z} from 'zod';

type SlackIntegrationConnection = ReadInteractionInput['connection'];

/**
 * `message` is listed as a follow-up, the role of a thread reply in a channel. A message in the
 * agent view or a direct message is a request, and `readInteraction` returns that role.
 */
export const slackInteractionEvents = {
  app_mention: 'request',
  message: 'follow_up',
  agent_session_stopped: 'stop',
} as const satisfies Record<string, InteractionRole>;

export const slackRequestContextSchema = {
  type: 'object',
  properties: {
    surface: {
      type: 'string',
      enum: ['channel', 'agent_view'],
      description: 'Where the request was made: a channel, or the agent view and direct messages.',
    },
    channel_id: {type: 'string', description: 'Channel or conversation the request was made in.'},
    channel_type: {
      type: 'string',
      description: 'Slack conversation type, such as channel, group, or im.',
    },
    viewing_channel_id: {
      type: 'string',
      description:
        'Channel the person was viewing when they wrote to the agent view. Empty when none.',
    },
    user_id: {type: 'string', description: 'Person who wrote the message.'},
    team_id: {type: 'string', description: 'Slack workspace ID.'},
  },
  required: ['surface', 'channel_id', 'channel_type', 'user_id', 'team_id'],
} as const;

export const SLACK_REPLY_GUIDANCE = [
  'You are answering in Slack. Write like a colleague in chat: a few short sentences, or a short list when the answer has parts.',
  'Lead with the answer. Skip greetings, sign-offs, and restating the question.',
  'Use Slack-friendly formatting: *bold* sparingly, `code` for identifiers, and fenced blocks for commands or logs.',
  'Do not use headings or tables. Keep long output out of the thread and link to where it lives.',
].join(' ');

const slackAppContextSchema = z
  .object({
    entities: z.array(z.object({type: z.string(), value: z.string()}).passthrough()).optional(),
    context: z
      .object({
        entities: z.array(z.object({type: z.string(), value: z.string()}).passthrough()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const slackInteractionPayloadSchema = z
  .object({
    type: z.string(),
    team_id: z.string().optional(),
    channel: z.string().optional(),
    channel_type: z.string().optional(),
    user: z.string().optional(),
    text: z.string().optional(),
    ts: z.string().optional(),
    thread_ts: z.string().optional(),
    bot_id: z.string().optional(),
    subtype: z.string().optional(),
    user_team: z.string().optional(),
    source_team: z.string().optional(),
    app_context: slackAppContextSchema.optional(),
  })
  .passthrough();
type SlackInteractionPayload = z.infer<typeof slackInteractionPayloadSchema>;

/** Subtypes of a real message from a person. Edits, deletions, joins, and bot posts are left out. */
const PERSON_MESSAGE_SUBTYPES: ReadonlySet<string | undefined> = new Set([
  undefined,
  'thread_broadcast',
  'file_share',
  'me_message',
]);

const CHANNEL_ENTITY_TYPE = 'slack#/types/channel_id';

export interface SlackInteractionProviderOptions {
  /** The bot user whose mention is removed from the text. */
  getBotUserId(connectionId: string): Promise<string | undefined>;
}

export function createSlackInteractionProvider(
  options: SlackInteractionProviderOptions,
): InteractionProvider<SlackIntegrationConnection> {
  return {
    interactionEvents: slackInteractionEvents,
    requestContextSchema: slackRequestContextSchema,
    replyGuidance: SLACK_REPLY_GUIDANCE,
    async readInteraction({connection, event, payload}) {
      const parsed = slackInteractionPayloadSchema.safeParse(payload);
      if (!parsed.success || parsed.data.type !== event) return undefined;
      const message = parsed.data;
      if (isFromBot(message) || isFromAnotherTeam(message, connection.externalAccountId)) {
        return undefined;
      }
      const botUserId = await options.getBotUserId(connection.id);

      switch (event) {
        case 'app_mention':
          return readMention({connection, message, botUserId});
        case 'message':
          return readMessage({connection, message, botUserId});
        case 'agent_session_stopped':
          return readStop({connection, message});
        default:
          return undefined;
      }
    },
    // Replies arrive with the Slack reply path.
    sendReply: () =>
      Promise.resolve({
        outcome: 'undeliverable',
        reason: 'Slack replies are not available yet.',
      }),
  };
}

function readMention(params: {
  connection: SlackIntegrationConnection;
  message: SlackInteractionPayload;
  botUserId: string | undefined;
}): Interaction | undefined {
  const {connection, message, botUserId} = params;
  const threadTs = message.thread_ts ?? message.ts;
  if (!message.channel || !threadTs) return undefined;
  return {
    conversationKey: conversationKey(connection.id, message.channel, threadTs),
    role: 'request',
    context: channelContext({connection, message, surface: 'channel'}),
    ...author(message),
    text: removeMention(message.text ?? '', botUserId),
  };
}

function readMessage(params: {
  connection: SlackIntegrationConnection;
  message: SlackInteractionPayload;
  botUserId: string | undefined;
}): Interaction | undefined {
  const {connection, message, botUserId} = params;
  if (!PERSON_MESSAGE_SUBTYPES.has(message.subtype)) return undefined;
  if (!message.channel) return undefined;

  if (message.channel_type === 'im') {
    const threadTs = message.thread_ts ?? message.ts;
    if (!threadTs) return undefined;
    const viewingChannelId = viewingChannel(message);
    return {
      conversationKey: conversationKey(connection.id, message.channel, threadTs),
      role: 'request',
      context: {
        ...channelContext({connection, message, surface: 'agent_view'}),
        ...(viewingChannelId === undefined ? {} : {viewing_channel_id: viewingChannelId}),
      },
      ...author(message),
      text: message.text ?? '',
    };
  }

  // Only a reply in a thread continues a conversation. A top-level channel message is not for an agent.
  if (!message.thread_ts || message.thread_ts === message.ts) return undefined;
  // Slack sends `app_mention` for the same message, which carries the request.
  if (botUserId !== undefined && mentions(message.text ?? '', botUserId)) return undefined;
  return {
    conversationKey: conversationKey(connection.id, message.channel, message.thread_ts),
    role: 'follow_up',
    context: channelContext({connection, message, surface: 'channel'}),
    ...author(message),
    text: message.text ?? '',
  };
}

function readStop(params: {
  connection: SlackIntegrationConnection;
  message: SlackInteractionPayload;
}): Interaction | undefined {
  const {connection, message} = params;
  if (!message.channel || !message.thread_ts) return undefined;
  return {
    conversationKey: conversationKey(connection.id, message.channel, message.thread_ts),
    role: 'stop',
    context: channelContext({connection, message, surface: 'agent_view'}),
    ...author(message),
    text: '',
  };
}

function conversationKey(connectionId: string, channel: string, threadTs: string): string {
  return `${connectionId}:${channel}:${threadTs}`;
}

function channelContext(params: {
  connection: SlackIntegrationConnection;
  message: SlackInteractionPayload;
  surface: 'channel' | 'agent_view';
}): Record<string, unknown> {
  const {connection, message, surface} = params;
  return {
    surface,
    channel_id: message.channel,
    channel_type: message.channel_type ?? (surface === 'agent_view' ? 'im' : 'channel'),
    user_id: message.user ?? '',
    team_id: connection.externalAccountId,
  };
}

function author(message: SlackInteractionPayload): Pick<Interaction, 'author'> | undefined {
  return message.user ? {author: {externalId: message.user}} : undefined;
}

function viewingChannel(message: SlackInteractionPayload): string | undefined {
  const entities = message.app_context?.context?.entities ?? message.app_context?.entities ?? [];
  return entities.find((entity) => entity.type === CHANNEL_ENTITY_TYPE)?.value;
}

/** The app's own replies, and every other app's, so two agents never answer each other. */
function isFromBot(message: SlackInteractionPayload): boolean {
  return message.bot_id !== undefined || message.subtype === 'bot_message';
}

/** A Slack Connect person belongs to a different workspace than the connection. */
function isFromAnotherTeam(message: SlackInteractionPayload, connectionTeamId: string): boolean {
  return [message.user_team, message.source_team].some(
    (team) => team !== undefined && team !== connectionTeamId,
  );
}

function mentions(text: string, botUserId: string): boolean {
  return mentionPattern(botUserId).test(text);
}

function removeMention(text: string, botUserId: string | undefined): string {
  if (botUserId === undefined) return text.trim();
  return text.replace(mentionPattern(botUserId, 'g'), '').trim();
}

function mentionPattern(botUserId: string, flags?: string): RegExp {
  return new RegExp(`<@${botUserId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\|[^>]*)?>`, flags);
}
