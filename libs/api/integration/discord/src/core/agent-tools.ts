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

function messagesOutputSchema(description: string): AgentToolJsonSchema {
  return {
    type: 'object',
    additionalProperties: true,
    properties: {
      messages: {
        type: 'array',
        description,
        items: {
          type: 'object',
          additionalProperties: true,
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
        },
      },
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
