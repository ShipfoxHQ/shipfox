import {
  SLACK_TOOL_METHODS,
  type SlackAgentToolId,
  slackAgentToolCatalog,
  slackAgentToolSelectionCatalog,
} from './agent-tools.js';

const expectedTools = [
  {id: 'conversations_history', sensitivity: 'read', requiredScope: 'read'},
  {id: 'conversations_replies', sensitivity: 'read', requiredScope: 'read'},
  {id: 'conversations_list', sensitivity: 'read', requiredScope: 'read'},
  {id: 'users_info', sensitivity: 'read', requiredScope: 'read'},
  {id: 'chat_postMessage', sensitivity: 'write', requiredScope: 'write'},
  {id: 'chat_update', sensitivity: 'write', requiredScope: 'write'},
  {id: 'reactions_add', sensitivity: 'write', requiredScope: 'write'},
] as const;

describe('slackAgentToolCatalog', () => {
  it('defines the seven Slack tools with their access requirements', () => {
    const tools = slackAgentToolCatalog.map(({id, sensitivity, requiredScope, sensitive}) => ({
      id,
      sensitivity,
      requiredScope,
      sensitive,
    }));

    expect(tools).toEqual(expectedTools.map((tool) => ({...tool, sensitive: false})));
  });

  it('documents every tool with an object input schema', () => {
    const schemas = slackAgentToolCatalog.map(({description, inputSchema}) => ({
      description,
      type: inputSchema.type,
    }));

    expect(schemas).toHaveLength(7);
    expect(
      schemas.every(({description, type}) => description.length > 0 && type === 'object'),
    ).toBe(true);
  });

  it('models Block Kit messages and Slack scalar parameters without narrowing valid calls', () => {
    const postMessage = slackAgentToolCatalog.find(({id}) => id === 'chat_postMessage');
    const listConversations = slackAgentToolCatalog.find(({id}) => id === 'conversations_list');
    const history = slackAgentToolCatalog.find(({id}) => id === 'conversations_history');

    expect(postMessage?.inputSchema).toMatchObject({
      required: ['channel'],
      properties: {
        blocks: {type: 'array', items: {type: 'object'}},
        thread_ts: {type: 'string'},
      },
    });
    expect(listConversations?.inputSchema).toMatchObject({
      properties: {types: {type: 'string'}, limit: {type: 'number'}},
    });
    expect(history?.inputSchema).toMatchObject({
      properties: {oldest: {type: 'string'}, latest: {type: 'string'}},
    });
  });

  it('maps every tool id to its dotted Slack Web API method', () => {
    const methods = Object.fromEntries(
      slackAgentToolCatalog.map(({id}) => [id, SLACK_TOOL_METHODS[id as SlackAgentToolId]]),
    );

    expect(methods).toEqual({
      conversations_history: 'conversations.history',
      conversations_replies: 'conversations.replies',
      conversations_list: 'conversations.list',
      users_info: 'users.info',
      chat_postMessage: 'chat.postMessage',
      chat_update: 'chat.update',
      reactions_add: 'reactions.add',
    });
  });

  it('exposes one standalone selector per tool with matching sensitivity', () => {
    const selectors = slackAgentToolSelectionCatalog.selectors;

    expect(selectors).toEqual(
      expectedTools.map(({id, sensitivity}) => ({
        token: id,
        kind: 'standalone',
        sensitivity,
        sensitive: false,
      })),
    );
  });
});
