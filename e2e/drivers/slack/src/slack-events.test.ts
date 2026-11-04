import {
  buildAgentSessionStoppedEnvelope,
  buildAppMentionEnvelope,
  buildMessageEnvelope,
} from './slack-events.js';

const base = {
  teamId: 'T1',
  channel: 'C1',
  ts: '1.000200',
  user: 'U1',
  text: '<@Ubot> where is it?',
  eventId: 'Ev1',
};

describe('buildAppMentionEnvelope', () => {
  it('leaves thread_ts out of a top-level mention', () => {
    const envelope = buildAppMentionEnvelope(base);

    expect(envelope.event).not.toHaveProperty('thread_ts');
  });

  it('carries the parent message of a mention made inside a thread', () => {
    const envelope = buildAppMentionEnvelope({...base, threadTs: '1.000100'});

    expect(envelope.event).toMatchObject({channel: 'C1', ts: '1.000200', thread_ts: '1.000100'});
  });
});

describe('buildMessageEnvelope', () => {
  it('carries the thread, the app, and the viewed channel when given', () => {
    const envelope = buildMessageEnvelope({
      teamId: 'T1',
      channel: 'D1',
      channelType: 'im',
      ts: '1.000300',
      text: 'hello',
      user: 'U1',
      botId: 'B1',
      subtype: 'bot_message',
      viewingChannelId: 'C1',
      eventId: 'Ev2',
    });

    expect(envelope.event).toEqual({
      type: 'message',
      channel: 'D1',
      channel_type: 'im',
      ts: '1.000300',
      text: 'hello',
      user: 'U1',
      bot_id: 'B1',
      subtype: 'bot_message',
      app_context: {context: {entities: [{type: 'slack#/types/channel_id', value: 'C1'}]}},
    });
    expect(envelope).not.toHaveProperty('event.thread_ts');
  });
});

describe('buildAgentSessionStoppedEnvelope', () => {
  it('names the session by its channel and thread', () => {
    const envelope = buildAgentSessionStoppedEnvelope({
      teamId: 'T1',
      channel: 'D1',
      threadTs: '1.000300',
      eventId: 'Ev3',
    });

    expect(envelope.event).toMatchObject({
      type: 'agent_session_stopped',
      channel: 'D1',
      thread_ts: '1.000300',
    });
  });
});
