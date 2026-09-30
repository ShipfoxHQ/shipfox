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
    outputSchema: {
      type: 'object',
      additionalProperties: true,
      properties: {
        messages: {
          type: 'array',
          description: 'Messages, newest first',
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

function stringSchema(description: string): AgentToolJsonSchema {
  return {type: 'string', description};
}

function snowflakeSchema(description: string): AgentToolJsonSchema {
  return {type: 'string', description, pattern: SNOWFLAKE_PATTERN};
}

function integerSchema(description: string, minimum: number, maximum: number): AgentToolJsonSchema {
  return {type: 'integer', description, minimum, maximum};
}
