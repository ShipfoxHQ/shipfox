import type {
  AgentToolCatalogEntry,
  AgentToolJsonSchema,
  AgentToolSelectionCatalog,
  AgentToolSelector,
} from '@shipfox/api-integration-spi';

export type SlackAgentToolRequiredScope = 'read' | 'write';
export type SlackAgentToolCatalogEntry = AgentToolCatalogEntry<SlackAgentToolRequiredScope>;

interface SlackAgentToolCatalogInput {
  id: string;
  description: string;
  sensitivity: 'read' | 'write';
  sensitive: boolean;
  requiredScope: SlackAgentToolRequiredScope;
  inputSchema: AgentToolJsonSchema;
}

const channelSchema = stringSchema('Slack channel ID');
const cursorSchema = stringSchema('Next page cursor');
const limitSchema = numberSchema('Maximum number of results to return');

export const slackAgentToolCatalog = [
  tool({
    id: 'conversations_history',
    description: 'List messages in a Slack channel or direct message.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        channel: channelSchema,
        cursor: cursorSchema,
        limit: limitSchema,
        oldest: stringSchema('Only messages after this Slack timestamp'),
        latest: stringSchema('Only messages before this Slack timestamp'),
        inclusive: booleanSchema('Include messages at the oldest or latest timestamp'),
      },
      ['channel'],
    ),
  }),
  tool({
    id: 'conversations_replies',
    description: 'List replies in a Slack message thread.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema(
      {
        channel: channelSchema,
        ts: stringSchema('Slack timestamp of the parent message'),
        cursor: cursorSchema,
        limit: limitSchema,
      },
      ['channel', 'ts'],
    ),
  }),
  tool({
    id: 'conversations_list',
    description: 'List Slack channels visible to the bot.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({
      cursor: cursorSchema,
      limit: limitSchema,
      types: stringSchema('Comma-separated channel types, such as public_channel,private_channel'),
      exclude_archived: booleanSchema('Exclude archived channels'),
    }),
  }),
  tool({
    id: 'users_info',
    description: 'Look up a Slack user and profile by user ID.',
    sensitivity: 'read',
    sensitive: false,
    requiredScope: 'read',
    inputSchema: objectSchema({user: stringSchema('Slack user ID')}, ['user']),
  }),
  tool({
    id: 'chat_postMessage',
    description: 'Post a Slack message to a channel or thread. Provide text, blocks, or both.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        channel: channelSchema,
        text: stringSchema('Message text'),
        thread_ts: stringSchema('Slack timestamp of the parent message when replying in a thread'),
        blocks: arraySchema({type: 'object'}),
      },
      ['channel'],
    ),
  }),
  tool({
    id: 'chat_update',
    description: 'Update a Slack message with text, blocks, or both.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        channel: channelSchema,
        ts: stringSchema('Slack timestamp of the message to update'),
        text: stringSchema('Updated message text'),
        blocks: arraySchema({type: 'object'}),
      },
      ['channel', 'ts'],
    ),
  }),
  tool({
    id: 'reactions_add',
    description: 'Add an emoji reaction to a Slack message.',
    sensitivity: 'write',
    sensitive: false,
    requiredScope: 'write',
    inputSchema: objectSchema(
      {
        channel: channelSchema,
        timestamp: stringSchema('Slack timestamp of the message'),
        name: stringSchema('Emoji name without surrounding colons'),
      },
      ['channel', 'timestamp', 'name'],
    ),
  }),
] as const satisfies readonly SlackAgentToolCatalogEntry[];

export type SlackAgentToolId = (typeof slackAgentToolCatalog)[number]['id'];

export const SLACK_TOOL_METHODS = {
  conversations_history: 'conversations.history',
  conversations_replies: 'conversations.replies',
  conversations_list: 'conversations.list',
  users_info: 'users.info',
  chat_postMessage: 'chat.postMessage',
  chat_update: 'chat.update',
  reactions_add: 'reactions.add',
} as const satisfies Record<SlackAgentToolId, string>;

export const slackAgentToolSelectionCatalog =
  buildSlackAgentToolSelectionCatalog(slackAgentToolCatalog);

function buildSlackAgentToolSelectionCatalog(
  catalog: readonly SlackAgentToolCatalogEntry[],
): AgentToolSelectionCatalog {
  return {
    selectors: catalog.map(
      (entry): AgentToolSelector => ({
        token: entry.id,
        kind: 'standalone',
        sensitivity: entry.sensitivity,
        sensitive: entry.sensitive,
      }),
    ),
  };
}

function tool<const Entry extends SlackAgentToolCatalogInput>(input: Entry): Entry {
  return input;
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

function stringSchema(description?: string): AgentToolJsonSchema {
  return {type: 'string', ...(description ? {description} : {})};
}

function numberSchema(description?: string): AgentToolJsonSchema {
  return {type: 'number', ...(description ? {description} : {})};
}

function booleanSchema(description: string): AgentToolJsonSchema {
  return {type: 'boolean', description};
}

function arraySchema(items: AgentToolJsonSchema): AgentToolJsonSchema {
  return {type: 'array', items};
}
