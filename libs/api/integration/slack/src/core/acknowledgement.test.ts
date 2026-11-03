import {createSlackEventAcknowledger} from './acknowledgement.js';
import type {SlackMessaging} from './replies.js';

const CONNECTION_ID = '0196b0a2-0000-7000-8000-000000000001';

function setup() {
  const callMethod = vi.fn(() => Promise.resolve({ok: true}));
  const messaging = {
    slack: {callMethod},
    tokenStore: {getAccessToken: () => Promise.resolve('xoxb-token')},
  } as SlackMessaging;
  const acknowledge = createSlackEventAcknowledger(messaging);
  return {
    callMethod,
    acknowledge: (event: Record<string, unknown>) =>
      acknowledge({connectionId: CONNECTION_ID, teamId: 'T1', event}),
  };
}

describe('Slack event acknowledgement', () => {
  it('reacts with eyes to a channel mention', async () => {
    const {callMethod, acknowledge} = setup();

    await acknowledge({type: 'app_mention', channel: 'C1', user: 'U1', text: 'hi', ts: '101.1'});

    expect(callMethod).toHaveBeenCalledWith({
      method: 'reactions.add',
      token: 'xoxb-token',
      arguments: {channel: 'C1', timestamp: '101.1', name: 'eyes'},
    });
  });

  it('sets the agent view to processing for a direct message', async () => {
    const {callMethod, acknowledge} = setup();

    await acknowledge({type: 'message', channel: 'D1', channel_type: 'im', user: 'U1', ts: '5.1'});

    expect(callMethod).toHaveBeenCalledWith({
      method: 'agents.sessions.setStatus',
      token: 'xoxb-token',
      arguments: {channel_id: 'D1', thread_ts: '5.1', status: 'processing'},
    });
  });

  it('keeps the thread timestamp of a message in an existing agent view thread', async () => {
    const {callMethod, acknowledge} = setup();

    await acknowledge({
      type: 'message',
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      ts: '6.1',
      thread_ts: '5.1',
    });

    expect(callMethod).toHaveBeenCalledWith(
      expect.objectContaining({arguments: expect.objectContaining({thread_ts: '5.1'})}),
    );
  });

  it.each([
    {
      name: 'a thread reply in a channel',
      event: {
        type: 'message',
        channel: 'C1',
        channel_type: 'channel',
        user: 'U1',
        ts: '2.1',
        thread_ts: '1.1',
      },
    },
    {
      name: 'a message from a bot',
      event: {type: 'app_mention', channel: 'C1', bot_id: 'B1', ts: '2.1'},
    },
    {
      name: 'a Slack Connect person',
      event: {type: 'app_mention', channel: 'C1', user: 'U9', user_team: 'T2', ts: '2.1'},
    },
    {
      name: 'an edited message',
      event: {
        type: 'message',
        channel: 'D1',
        channel_type: 'im',
        subtype: 'message_changed',
        ts: '2.1',
      },
    },
    {
      name: 'an event that is not a request',
      event: {type: 'reaction_added', channel: 'C1', ts: '2.1'},
    },
  ])('shows nothing for $name', async ({event}) => {
    const {callMethod, acknowledge} = setup();

    await acknowledge(event);

    expect(callMethod).not.toHaveBeenCalled();
  });
});
