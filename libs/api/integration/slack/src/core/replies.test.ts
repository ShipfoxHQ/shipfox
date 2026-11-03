import {SlackAccessTokenUnavailableError, SlackIntegrationProviderError} from '#core/errors.js';
import {reportSlackProgress, type SlackMessaging, sendSlackReply} from './replies.js';

const CONNECTION_ID = '0196b0a2-0000-7000-8000-000000000001';
const AGENT = {name: 'Shippy'};

interface PostedCall {
  arguments: {blocks: {text: string}[]};
}

function setup(responses: Record<string, unknown> = {}) {
  const callMethod = vi.fn(({method}: {method: string}) =>
    Promise.resolve((responses[method] ?? {ok: true}) as {ok: boolean; error?: string}),
  );
  const getAccessToken = vi.fn(() => Promise.resolve('xoxb-token'));
  const messaging = {slack: {callMethod}, tokenStore: {getAccessToken}} as SlackMessaging;
  return {messaging, callMethod, getAccessToken};
}

describe('sendSlackReply', () => {
  it('posts in the thread under the agent name with a Markdown block', async () => {
    const {messaging, callMethod} = setup();

    const outcome = await sendSlackReply(messaging, {
      conversationKey: `${CONNECTION_ID}:C1:100.1`,
      text: 'It is **fixed**',
      agent: AGENT,
    });

    expect(outcome).toEqual({outcome: 'delivered'});
    expect(callMethod).toHaveBeenCalledWith({
      method: 'chat.postMessage',
      token: 'xoxb-token',
      arguments: {
        channel: 'C1',
        thread_ts: '100.1',
        username: 'Shippy',
        text: 'It is fixed',
        blocks: [{type: 'markdown', text: 'It is **fixed**'}],
      },
    });
  });

  it('splits an answer over the Markdown block limit into several messages', async () => {
    const {messaging, callMethod} = setup();
    const line = 'a'.repeat(7_000);

    await sendSlackReply(messaging, {
      conversationKey: `${CONNECTION_ID}:C1:100.1`,
      text: `${line}\n${line}`,
      agent: AGENT,
    });

    expect(
      callMethod.mock.calls.map(
        ([call]) => (call as unknown as PostedCall).arguments.blocks[0]?.text,
      ),
    ).toEqual([line, line]);
  });

  it.each([
    'is_archived',
    'channel_not_found',
    'not_in_channel',
    'token_revoked',
  ])('returns undeliverable when Slack answers %s', async (error) => {
    const {messaging} = setup({'chat.postMessage': {ok: false, error}});

    const outcome = await sendSlackReply(messaging, {
      conversationKey: `${CONNECTION_ID}:C1:100.1`,
      text: 'hi',
      agent: AGENT,
    });

    expect(outcome).toEqual({outcome: 'undeliverable', reason: error});
  });

  it('returns undeliverable when the app was removed', async () => {
    const {messaging, getAccessToken} = setup();
    getAccessToken.mockRejectedValue(
      new SlackAccessTokenUnavailableError(CONNECTION_ID, 'not-installed'),
    );

    const outcome = await sendSlackReply(messaging, {
      conversationKey: `${CONNECTION_ID}:C1:100.1`,
      text: 'hi',
      agent: AGENT,
    });

    expect(outcome).toEqual({
      outcome: 'undeliverable',
      reason: 'app-unavailable: not-installed',
    });
  });

  it('throws on a transient Slack error so the reply is retried', async () => {
    const {messaging} = setup({'chat.postMessage': {ok: false, error: 'ratelimited'}});

    await expect(
      sendSlackReply(messaging, {
        conversationKey: `${CONNECTION_ID}:C1:100.1`,
        text: 'hi',
        agent: AGENT,
      }),
    ).rejects.toBeInstanceOf(SlackIntegrationProviderError);
  });

  it('returns undeliverable for a key it did not issue', async () => {
    const {messaging, callMethod} = setup();

    const outcome = await sendSlackReply(messaging, {
      conversationKey: 'not-a-key',
      text: 'hi',
      agent: AGENT,
    });

    expect(outcome).toEqual({outcome: 'undeliverable', reason: 'invalid-conversation-key'});
    expect(callMethod).not.toHaveBeenCalled();
  });
});

describe('reportSlackProgress', () => {
  it('sets processing in the agent view while working', async () => {
    const {messaging, callMethod} = setup();

    await reportSlackProgress(messaging, {
      conversationKey: `${CONNECTION_ID}:D1:100.1`,
      state: 'working',
    });

    expect(callMethod).toHaveBeenCalledWith({
      method: 'agents.sessions.setStatus',
      token: 'xoxb-token',
      arguments: {channel_id: 'D1', thread_ts: '100.1', status: 'processing'},
    });
  });

  it('sets active when idle', async () => {
    const {messaging, callMethod} = setup();

    await reportSlackProgress(messaging, {
      conversationKey: `${CONNECTION_ID}:D1:100.1`,
      state: 'idle',
    });

    expect(callMethod).toHaveBeenCalledWith(
      expect.objectContaining({arguments: expect.objectContaining({status: 'active'})}),
    );
  });

  it('shows nothing in a channel', async () => {
    const {messaging, callMethod} = setup();

    await reportSlackProgress(messaging, {
      conversationKey: `${CONNECTION_ID}:C1:100.1`,
      state: 'working',
    });

    expect(callMethod).not.toHaveBeenCalled();
  });

  it('does not throw when Slack fails, because progress is cosmetic', async () => {
    const {messaging, callMethod} = setup();
    callMethod.mockRejectedValue(new SlackIntegrationProviderError('timeout', 'timed out'));

    await expect(
      reportSlackProgress(messaging, {
        conversationKey: `${CONNECTION_ID}:D1:100.1`,
        state: 'idle',
      }),
    ).resolves.toBeUndefined();
  });
});
