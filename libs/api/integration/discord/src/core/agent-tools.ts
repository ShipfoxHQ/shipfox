import type {DiscordAgentToolId} from '@shipfox/api-integration-discord-dto';
import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';

export type DiscordAgentToolRequiredScope = 'read' | 'write';
export type DiscordAgentToolCatalogEntry = AgentToolCatalogEntry<DiscordAgentToolRequiredScope>;

interface DiscordAgentToolCatalogInput {
  id: DiscordAgentToolId;
  description: string;
  sensitivity?: DiscordAgentToolRequiredScope;
  inputSchema: AgentToolJsonSchema;
  outputSchema: AgentToolJsonSchema;
}

const SNOWFLAKE_PATTERN = '^[0-9]{1,20}$';

export const discordAgentToolCatalog = [
  tool({
    id: 'read_channel',
    description:
      'Read messages from a Discord channel or thread in reverse chronological order (newest first). Page with a message ID in either before or after, not both.',
    inputSchema: objectSchema(
      {
        channel_id: snowflakeSchema('ID of a channel or thread in the connected Discord server'),
        limit: integerSchema('Messages to return, 1 to 100 (default 50)', 1, 100),
        before: snowflakeSchema('Only return messages older than this message ID'),
        after: snowflakeSchema('Only return messages newer than this message ID'),
      },
      ['channel_id'],
    ),
    outputSchema: messagesOutputSchema('Messages, newest first'),
  }),
  tool({
    id: 'read_thread',
    description:
      'Read a Discord thread, oldest message first. With a thread ID as channel_id, returns the message the thread started from, then the thread. With a channel ID and the ID of a message that started a thread, returns that message then its thread. With a channel ID and a message ID that started no thread, returns that single message. The same arguments work for a mention at the top level of a channel and inside a thread.',
    inputSchema: objectSchema(
      {
        channel_id: snowflakeSchema('ID of a channel or thread in the connected Discord server'),
        message_id: snowflakeSchema(
          'ID of a message in the channel. Required unless channel_id is a thread, and ignored when it is one',
        ),
        limit: integerSchema(
          'Most recent thread messages to return, 1 to 100 (default 50)',
          1,
          100,
        ),
      },
      ['channel_id'],
    ),
    outputSchema: messagesOutputSchema('Messages, oldest first'),
  }),
  tool({
    id: 'list_channels',
    description:
      'List the channels of the connected Discord server, and optionally its active threads, to find a channel ID by name.',
    inputSchema: objectSchema({
      name_contains: stringSchema(
        'Only return channels whose name contains this text, ignoring case',
      ),
      include_threads: {
        type: 'boolean',
        description: 'Also return the active threads of the server (default false)',
      },
    }),
    outputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        channels: {
          type: 'array',
          description: 'Channels and, when requested, active threads',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: stringSchema('Channel ID'),
              name: stringSchema('Channel name'),
              type: {
                type: 'integer',
                description:
                  'Discord channel type: 0 text, 2 voice, 4 category, 5 announcement, 10 to 12 thread, 13 stage, 15 forum',
              },
              parent_id: {
                type: ['string', 'null'],
                description: 'ID of the category, or of the channel a thread belongs to',
              },
              topic: {type: ['string', 'null'], description: 'Channel topic'},
            },
          },
        },
      },
    },
  }),
  tool({
    id: 'search_messages',
    description:
      'Search the messages of the connected Discord server by text. Returns the matching messages, each with a link. A new server can answer with a rate-limited error while Discord indexes it: retry after retryAfterSeconds.',
    inputSchema: objectSchema(
      {
        query: stringSchema('Text to search for in message content'),
        channel_id: snowflakeSchema('Only search this channel or thread'),
        author_id: snowflakeSchema('Only return messages from this user ID'),
        limit: integerSchema('Messages to return, 1 to 25 (default 25)', 1, 25),
        offset: integerSchema('Matches to skip, to page through results', 0, 9975),
      },
      ['query'],
    ),
    outputSchema: messagesOutputSchema('Matching messages', {
      total_results: {type: 'integer', description: 'Number of messages that match'},
    }),
  }),
  tool({
    id: 'read_user_profile',
    description:
      'Retrieve a member of the connected Discord server: nickname, username, global name, role IDs, and join date. Discord never exposes email addresses.',
    inputSchema: objectSchema(
      {user_id: snowflakeSchema('ID of a user in the connected Discord server')},
      ['user_id'],
    ),
    outputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: stringSchema('User ID'),
        username: stringSchema('Username'),
        global_name: {type: ['string', 'null'], description: 'Display name across Discord'},
        nickname: {type: ['string', 'null'], description: 'Nickname in this server'},
        bot: {type: 'boolean', description: 'Whether the user is a bot'},
        roles: {
          type: 'array',
          description: 'IDs of the roles the member has',
          items: {type: 'string'},
        },
        joined_at: stringSchema('ISO 8601 timestamp of when the member joined the server'),
      },
    },
  }),
  tool({
    id: 'send_message',
    sensitivity: 'write',
    description:
      'Send a message to a Discord channel or thread as the bot. Markdown is supported. Messages over 2,000 characters are split on paragraph, line, or word boundaries into up to 5 messages, and messages over 10,000 characters are refused. Only users are pinged, never roles or @everyone. To answer in the thread of a message, pass its ID as thread_message_id: the thread is created if the message has none, and thread_message_id is ignored when channel_id is already a thread.',
    inputSchema: objectSchema(
      {
        channel_id: snowflakeSchema('ID of a channel or thread in the connected Discord server'),
        message: stringSchema('Message text in Markdown'),
        reply_to_message_id: snowflakeSchema(
          'ID of a message in channel_id to reply to. Ignored when thread_message_id starts or finds a thread, because that message is in another channel',
        ),
        thread_message_id: snowflakeSchema(
          'ID of a message in channel_id whose thread receives the message, created when the message has none',
        ),
      },
      ['channel_id', 'message'],
    ),
    outputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: stringSchema('ID of the first message posted'),
        channel_id: stringSchema('ID of the channel or thread the messages were posted in'),
        url: stringSchema('Link to the first message posted'),
        messages: {
          type: 'array',
          description: 'Messages posted, in order',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: stringSchema('Message ID'),
              channel_id: stringSchema('ID of the channel or thread the message is in'),
              url: stringSchema('Link to the message'),
              content: stringSchema('Message text'),
            },
          },
        },
      },
    },
  }),
  tool({
    id: 'create_thread',
    sensitivity: 'write',
    description:
      'Create a public thread in a Discord channel. With message_id, the thread starts from that message and its ID is returned when the message already has a thread. Without it, the thread stands alone. In a forum or media channel, message is required and becomes the post: message_id is not accepted there. Only users are pinged, never roles or @everyone. Post in the new thread with send_message, using the returned ID as channel_id.',
    inputSchema: objectSchema(
      {
        channel_id: snowflakeSchema('ID of a channel in the connected Discord server'),
        name: stringSchema('Thread name, 1 to 100 characters'),
        message_id: snowflakeSchema(
          'ID of a message in channel_id to start the thread from. Not accepted in a forum or media channel',
        ),
        message: stringSchema(
          'Text of the post in Markdown, up to 2,000 characters. Required in a forum or media channel, and not accepted elsewhere',
        ),
      },
      ['channel_id', 'name'],
    ),
    outputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        id: stringSchema('ID of the thread'),
        channel_id: stringSchema('ID of the channel the thread belongs to'),
        url: stringSchema('Link to the thread'),
      },
    },
  }),
  tool({
    id: 'update_message',
    sensitivity: 'write',
    description:
      'Replace the text of a message the bot posted in a Discord channel or thread. Messages from anyone else cannot be edited. Markdown is supported, up to 2,000 characters, and the text is not split. Only users are pinged, never roles or @everyone.',
    inputSchema: objectSchema(
      {
        channel_id: snowflakeSchema('ID of the channel or thread the message is in'),
        message_id: snowflakeSchema('ID of the message to edit'),
        message: stringSchema('New message text in Markdown, up to 2,000 characters'),
      },
      ['channel_id', 'message_id', 'message'],
    ),
    outputSchema: messageSchema('The edited message'),
  }),
  tool({
    id: 'add_reaction',
    sensitivity: 'write',
    description:
      'Add a reaction from the bot to a message. emoji is the Unicode emoji itself, for example 👍, or name:id for a custom emoji of the server.',
    inputSchema: objectSchema(
      {
        channel_id: snowflakeSchema('ID of the channel or thread the message is in'),
        message_id: snowflakeSchema('ID of the message to react to'),
        emoji: stringSchema('Unicode emoji, or name:id for a custom emoji'),
      },
      ['channel_id', 'message_id', 'emoji'],
    ),
    outputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        channel_id: stringSchema('ID of the channel or thread the message is in'),
        message_id: stringSchema('ID of the message reacted to'),
        emoji: stringSchema('The emoji added'),
        url: stringSchema('Link to the message'),
      },
    },
  }),
] as const satisfies readonly DiscordAgentToolCatalogEntry[];

export const discordAgentToolSelectionCatalog: AgentToolSelectionCatalog = {
  selectors: discordAgentToolCatalog.map(
    (entry): AgentToolSelector => ({
      token: entry.id,
      kind: 'standalone',
      sensitivity: entry.sensitivity,
      sensitive: entry.sensitive,
    }),
  ),
};

function tool(input: DiscordAgentToolCatalogInput): DiscordAgentToolCatalogEntry {
  const sensitivity = input.sensitivity ?? 'read';
  return {
    id: input.id,
    description: input.description,
    sensitivity,
    sensitive: false,
    requiredScope: sensitivity,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
  };
}

function objectSchema(
  properties: Record<string, AgentToolJsonSchema>,
  required: string[] = [],
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? {required} : {}),
  };
}

function messagesOutputSchema(
  description: string,
  extraProperties: Record<string, AgentToolJsonSchema> = {},
): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      ...extraProperties,
      messages: {type: 'array', description, items: messageSchema()},
    },
  };
}

function messageSchema(description?: string): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    ...(description === undefined ? {} : {description}),
    properties: {
      id: stringSchema('Message ID'),
      channel_id: stringSchema('ID of the channel or thread the message is in'),
      url: stringSchema('Link to the message'),
      content: stringSchema('Message text'),
      author: {
        type: 'object',
        additionalProperties: true,
        properties: {
          id: stringSchema('Author user ID'),
          username: stringSchema('Author username'),
          bot: {type: 'boolean', description: 'Whether the author is a bot'},
        },
      },
      timestamp: stringSchema('ISO 8601 timestamp of when the message was sent'),
    },
  };
}

function stringSchema(description: string): AgentToolJsonSchema {
  return {type: 'string', description};
}

function snowflakeSchema(description: string): AgentToolJsonSchema {
  return {type: 'string', description, pattern: SNOWFLAKE_PATTERN};
}

function integerSchema(description: string, minimum: number, maximum: number): AgentToolJsonSchema {
  return {type: 'integer', description, minimum, maximum};
}
