import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {createSlackInteractionProvider, slackInteractionEvents} from './interaction-provider.js';

const BOT_USER_ID = 'UBOT';
const connection: IntegrationConnection = {
  id: '0196b0a2-0000-7000-8000-000000000001',
  workspaceId: '0196b0a2-0000-7000-8000-000000000002',
  provider: 'slack',
  externalAccountId: 'T1',
  slug: 'slack_acme',
  displayName: 'Slack Acme',
  lifecycleStatus: 'active',
  repositoryAccessMode: 'selected',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function read(event: string, payload: Record<string, unknown>) {
  const provider = createSlackInteractionProvider({
    getBotUserId: () => Promise.resolve(BOT_USER_ID),
  });
  return provider.readInteraction({
    connection,
    event,
    payload: {type: event, team_id: 'T1', ...payload},
  });
}

describe('Slack interaction provider', () => {
  it('reads a top-level mention as a request keyed by its own timestamp', async () => {
    const result = await read('app_mention', {
      channel: 'C1',
      channel_type: 'channel',
      user: 'U1',
      text: `<@${BOT_USER_ID}> what broke?`,
      ts: '100.1',
    });

    expect(result).toEqual({
      conversationKey: `${connection.id}:C1:100.1`,
      role: 'request',
      context: {
        surface: 'channel',
        channel_id: 'C1',
        channel_type: 'channel',
        user_id: 'U1',
        team_id: 'T1',
      },
      author: {externalId: 'U1'},
      text: 'what broke?',
    });
  });

  it('keys a mention in a thread by the thread timestamp', async () => {
    const result = await read('app_mention', {
      channel: 'C1',
      user: 'U1',
      text: `hey <@${BOT_USER_ID}> look`,
      ts: '101.1',
      thread_ts: '100.1',
    });

    expect(result?.conversationKey).toBe(`${connection.id}:C1:100.1`);
    expect(result?.text).toBe('hey  look');
  });

  it('reads a thread reply in a channel as a follow-up on the thread key', async () => {
    const result = await read('message', {
      channel: 'C1',
      channel_type: 'channel',
      user: 'U1',
      text: 'and the logs?',
      ts: '102.1',
      thread_ts: '100.1',
    });

    expect(result).toMatchObject({
      conversationKey: `${connection.id}:C1:100.1`,
      role: 'follow_up',
      context: {surface: 'channel', channel_id: 'C1'},
      text: 'and the logs?',
    });
  });

  it('ignores a top-level channel message and the thread parent', async () => {
    const topLevel = await read('message', {channel: 'C1', user: 'U1', text: 'hi', ts: '1.1'});
    const parent = await read('message', {
      channel: 'C1',
      user: 'U1',
      text: 'hi',
      ts: '1.1',
      thread_ts: '1.1',
    });

    expect(topLevel).toBeUndefined();
    expect(parent).toBeUndefined();
  });

  it('leaves a mention inside a thread reply to its app_mention event', async () => {
    const result = await read('message', {
      channel: 'C1',
      user: 'U1',
      text: `<@${BOT_USER_ID}> and now?`,
      ts: '103.1',
      thread_ts: '100.1',
    });

    expect(result).toBeUndefined();
  });

  it('reads an agent view message as a request with the viewed channel', async () => {
    const result = await read('message', {
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      text: 'summarize this channel',
      ts: '200.2',
      thread_ts: '200.1',
      app_context: {
        context: {entities: [{type: 'slack#/types/channel_id', value: 'C9', team_id: 'T1'}]},
      },
    });

    expect(result).toEqual({
      conversationKey: `${connection.id}:D1:200.1`,
      role: 'request',
      context: {
        surface: 'agent_view',
        channel_id: 'D1',
        channel_type: 'im',
        viewing_channel_id: 'C9',
        user_id: 'U1',
        team_id: 'T1',
      },
      author: {externalId: 'U1'},
      text: 'summarize this channel',
    });
  });

  it('reads a direct message without app context and without a thread', async () => {
    const result = await read('message', {
      channel: 'D1',
      channel_type: 'im',
      user: 'U1',
      text: 'hello',
      ts: '300.1',
    });

    expect(result?.conversationKey).toBe(`${connection.id}:D1:300.1`);
    expect(result?.context).not.toHaveProperty('viewing_channel_id');
  });

  it('reads the agent view stop control as a stop on the session thread', async () => {
    const result = await read('agent_session_stopped', {
      channel: 'D1',
      thread_ts: '200.1',
      user: 'U1',
      streaming_message_ts: ['200.3'],
    });

    expect(result).toMatchObject({
      conversationKey: `${connection.id}:D1:200.1`,
      role: 'stop',
      context: {surface: 'agent_view', channel_id: 'D1'},
      author: {externalId: 'U1'},
      text: '',
    });
  });

  it.each([
    {name: 'a bot_id', extra: {bot_id: 'B1'}},
    {name: 'the bot_message subtype', extra: {subtype: 'bot_message'}},
  ])('never turns a message with $name into an interaction', async ({extra}) => {
    const mention = await read('app_mention', {
      channel: 'C1',
      text: `<@${BOT_USER_ID}> hi`,
      ts: '1.1',
      ...extra,
    });
    const reply = await read('message', {
      channel: 'C1',
      text: 'done',
      ts: '2.1',
      thread_ts: '1.1',
      ...extra,
    });
    const direct = await read('message', {
      channel: 'D1',
      channel_type: 'im',
      text: 'done',
      ts: '3.1',
      ...extra,
    });

    expect([mention, reply, direct]).toEqual([undefined, undefined, undefined]);
  });

  it.each([
    'message_changed',
    'message_deleted',
    'channel_join',
  ])('ignores a message with the %s subtype', async (subtype) => {
    const result = await read('message', {
      channel: 'C1',
      text: 'x',
      ts: '2.1',
      thread_ts: '1.1',
      subtype,
    });

    expect(result).toBeUndefined();
  });

  it.each([
    {user_team: 'T2'},
    {source_team: 'T2'},
  ])('ignores a Slack Connect user from another team: %o', async (extra) => {
    const result = await read('app_mention', {
      channel: 'C1',
      user: 'U2',
      text: `<@${BOT_USER_ID}> hi`,
      ts: '1.1',
      ...extra,
    });

    expect(result).toBeUndefined();
  });

  it('accepts a user from the connection team', async () => {
    const result = await read('app_mention', {
      channel: 'C1',
      user: 'U1',
      text: `<@${BOT_USER_ID}> hi`,
      ts: '1.1',
      user_team: 'T1',
    });

    expect(result?.role).toBe('request');
  });

  it('starts nothing from the events that only set up the agent view', async () => {
    const started = await read('assistant_thread_started', {
      assistant_thread: {user_id: 'U1', channel_id: 'D1', thread_ts: '1.1'},
    });
    const changed = await read('app_context_changed', {context: {entities: []}});

    expect([started, changed]).toEqual([undefined, undefined]);
    expect(Object.keys(slackInteractionEvents)).not.toContain('assistant_thread_started');
    expect(Object.keys(slackInteractionEvents)).not.toContain('app_context_changed');
  });

  it('declares the roles each event can have', () => {
    expect(slackInteractionEvents).toEqual({
      app_mention: 'request',
      message: 'follow_up',
      agent_session_stopped: 'stop',
    });
  });
});
