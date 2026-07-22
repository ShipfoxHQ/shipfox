import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {SlackWebApiResponse} from '#api/client.js';
import {slackAgentToolCatalog, slackAgentToolSelectionCatalog} from '#core/agent-tools.js';
import {SlackAgentToolsProvider} from '#core/agent-tools-provider.js';
import {SlackBotTokenMissingError, SlackIntegrationProviderError} from '#core/errors.js';

const mocks = vi.hoisted(() => ({warn: vi.fn()}));

vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: mocks.warn})}));

function slackConnection(
  overrides: Partial<IntegrationConnection<'slack'>> = {},
): IntegrationConnection<'slack'> {
  const now = new Date();
  return {
    id: 'slack-connection-1',
    workspaceId: 'workspace-1',
    provider: 'slack',
    externalAccountId: 'T123',
    slug: 'slack-acme',
    displayName: 'Slack Acme',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function catalogTool(id: string) {
  const tool = slackAgentToolCatalog.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown test tool: ${id}`);
  return tool;
}

function providerOptions(
  callMethod: (input: {
    method: string;
    token: string;
    arguments: Record<string, unknown>;
  }) => Promise<SlackWebApiResponse>,
) {
  return {
    slack: {callMethod: vi.fn(callMethod)},
    tokenStore: {getAccessToken: vi.fn().mockResolvedValue('xoxb-token')},
  };
}

async function openSession(
  options: ReturnType<typeof providerOptions>,
  toolIds: string[],
  connection = slackConnection(),
) {
  const provider = new SlackAgentToolsProvider(options);
  return await provider.openSession({
    connection,
    tools: toolIds.map(catalogTool),
    scope: {provider: 'slack'},
  });
}

describe('SlackAgentToolsProvider', () => {
  beforeEach(() => {
    mocks.warn.mockReset();
  });

  it('returns the Slack agent tools catalogs', () => {
    const options = providerOptions(async () => ({ok: true}));
    const provider = new SlackAgentToolsProvider(options);

    const catalog = provider.catalog();
    const selectionCatalog = provider.selectionCatalog();

    expect(catalog).toBe(slackAgentToolCatalog);
    expect(selectionCatalog).toBe(slackAgentToolSelectionCatalog);
  });

  it('reads the stored bot token for the connection before opening a session', async () => {
    const options = providerOptions(async () => ({ok: true}));
    const provider = new SlackAgentToolsProvider(options);

    await provider.openSession({
      connection: slackConnection({id: 'slack-connection-7'}),
      tools: [],
      scope: {provider: 'slack'},
    });

    expect(options.tokenStore.getAccessToken).toHaveBeenCalledWith({
      connectionId: 'slack-connection-7',
    });
  });

  it('dispatches a read method and returns the Slack response as structured content', async () => {
    const body = {ok: true, messages: [{text: 'Hello'}]};
    const options = providerOptions(async () => body);
    const session = await openSession(options, ['conversations_history']);

    const result = await session.call({
      toolId: 'conversations_history',
      arguments: {channel: 'C123', limit: 10},
    });

    expect(options.slack.callMethod).toHaveBeenCalledWith({
      method: 'conversations.history',
      token: 'xoxb-token',
      arguments: {channel: 'C123', limit: 10},
    });
    expect(result).toEqual({
      content: [{type: 'text', text: JSON.stringify(body)}],
      structuredContent: body,
    });
  });

  it('passes a thread timestamp through to the message-posting method', async () => {
    const options = providerOptions(async () => ({ok: true, ts: '456.000'}));
    const session = await openSession(options, ['chat_postMessage']);

    await session.call({
      toolId: 'chat_postMessage',
      arguments: {channel: 'C123', text: 'Reply', thread_ts: '123.000'},
    });

    expect(options.slack.callMethod).toHaveBeenCalledWith({
      method: 'chat.postMessage',
      token: 'xoxb-token',
      arguments: {channel: 'C123', text: 'Reply', thread_ts: '123.000'},
    });
  });

  it('rejects a tool that was not selected for the session', async () => {
    const options = providerOptions(async () => ({ok: true}));
    const session = await openSession(options, ['conversations_history']);

    const result = await session.call({toolId: 'users_info', arguments: {user: 'U123'}});

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Unknown Slack tool: users_info'}],
    });
    expect(options.slack.callMethod).not.toHaveBeenCalled();
  });

  it('rejects a call missing a required parameter', async () => {
    const options = providerOptions(async () => ({ok: true}));
    const session = await openSession(options, ['conversations_replies']);

    const result = await session.call({
      toolId: 'conversations_replies',
      arguments: {channel: 'C123'},
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'Missing required parameter: ts'}],
    });
    expect(options.slack.callMethod).not.toHaveBeenCalled();
  });

  it('returns a Slack application error to the agent', async () => {
    const options = providerOptions(async () => ({ok: false, error: 'channel_not_found'}));
    const session = await openSession(options, ['conversations_history']);

    const result = await session.call({
      toolId: 'conversations_history',
      arguments: {channel: 'C123'},
    });

    expect(result).toEqual({
      isError: true,
      content: [{type: 'text', text: 'channel_not_found'}],
    });
  });

  it('returns auth failures with a stable access-denied code and logs only metadata', async () => {
    const options = providerOptions(async () => ({ok: false, error: 'invalid_auth'}));
    const session = await openSession(options, ['conversations_history']);

    const result = await session.call({
      toolId: 'conversations_history',
      arguments: {channel: 'C123'},
    });

    expect(result).toMatchObject({
      isError: true,
      content: [{type: 'text', text: 'invalid_auth'}],
      structuredContent: {code: 'access-denied'},
    });
    expect(mocks.warn).toHaveBeenCalledWith(
      {connectionId: 'slack-connection-1', slackError: 'invalid_auth'},
      'Slack API rejected integration credentials',
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('xoxb-token');
  });

  it('returns an HTTP-200 rate-limit response with a stable code', async () => {
    const options = providerOptions(async () => ({ok: false, error: 'ratelimited'}));
    const session = await openSession(options, ['conversations_list']);

    const result = await session.call({toolId: 'conversations_list', arguments: {}});

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {code: 'rate-limited'},
    });
  });

  it('preserves retry details from a transport-level rate limit', async () => {
    const options = providerOptions(() =>
      Promise.reject(new SlackIntegrationProviderError('rate-limited', 'Try again later', 19)),
    );
    const session = await openSession(options, ['conversations_list']);

    const result = await session.call({toolId: 'conversations_list', arguments: {}});

    expect(result).toMatchObject({
      isError: true,
      content: [{type: 'text', text: 'Try again later'}],
      structuredContent: {code: 'rate-limited', retryAfterSeconds: 19},
    });
  });

  it('preserves content-too-large from a rejected Slack request', async () => {
    const options = providerOptions(() =>
      Promise.reject(
        new SlackIntegrationProviderError('content-too-large', 'Slack content was too large'),
      ),
    );
    const session = await openSession(options, ['chat_postMessage']);

    const result = await session.call({
      toolId: 'chat_postMessage',
      arguments: {channel: 'C123', blocks: []},
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {code: 'content-too-large'},
    });
  });

  it('does not call Slack when the bot token is missing', async () => {
    const options = providerOptions(async () => ({ok: true}));
    options.tokenStore.getAccessToken.mockRejectedValue(
      new SlackBotTokenMissingError('slack-connection-1'),
    );
    const provider = new SlackAgentToolsProvider(options);

    const result = provider.openSession({
      connection: slackConnection(),
      tools: [catalogTool('conversations_list')],
      scope: {provider: 'slack'},
    });

    await expect(result).rejects.toBeInstanceOf(SlackBotTokenMissingError);
    expect(options.slack.callMethod).not.toHaveBeenCalled();
  });
});
