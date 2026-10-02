import {startDiscordApiMock} from './discord-api.js';

const GUILD_ID = '100';
const CHANNEL_ID = '200';
const MESSAGE_ID = '300';

describe('Discord API mock', () => {
  async function arrange() {
    const mock = await startDiscordApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      botUserId: 'bot-1',
    });
    mock.addChannel({id: CHANNEL_ID, type: 0, guild_id: GUILD_ID});
    mock.addMessage({
      id: MESSAGE_ID,
      channel_id: CHANNEL_ID,
      content: 'hello',
      author: {id: 'user-1', username: 'user'},
    });
    const call = async (method: string, path: string, json?: unknown) => {
      const response = await fetch(new URL(path, mock.endpoint), {
        method,
        headers: {authorization: 'Bot test', 'content-type': 'application/json'},
        ...(json === undefined ? {} : {body: JSON.stringify(json)}),
      });
      return {status: response.status, body: await response.json()};
    };
    return {mock, call};
  }

  it('answers a channel and a message it knows, and 404 for one it does not', async () => {
    const {mock, call} = await arrange();

    try {
      const channel = await call('GET', `/channels/${CHANNEL_ID}`);
      const message = await call('GET', `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`);
      const missing = await call('GET', '/channels/999');

      expect(channel).toEqual({
        status: 200,
        body: {id: CHANNEL_ID, type: 0, guild_id: GUILD_ID},
      });
      expect(message.body).toMatchObject({id: MESSAGE_ID, content: 'hello'});
      expect(missing).toEqual({status: 404, body: {message: 'Unknown Channel', code: 10_003}});
    } finally {
      await mock.stop();
    }
  });

  it('starts a thread on a message and posts the bot reply into it', async () => {
    const {mock, call} = await arrange();

    try {
      const thread = await call('POST', `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/threads`, {
        name: 'hello',
      });
      const reply = await call('POST', `/channels/${MESSAGE_ID}/messages`, {content: 'hi'});
      const read = await call('GET', `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}`);
      const again = await call('POST', `/channels/${CHANNEL_ID}/messages/${MESSAGE_ID}/threads`, {
        name: 'again',
      });

      expect(thread.body).toEqual({
        id: MESSAGE_ID,
        type: 11,
        guild_id: GUILD_ID,
        parent_id: CHANNEL_ID,
        name: 'hello',
      });
      expect(reply.body).toMatchObject({
        channel_id: MESSAGE_ID,
        content: 'hi',
        author: {id: 'bot-1', bot: true},
      });
      expect(read.body).toMatchObject({thread: {id: MESSAGE_ID}});
      expect(again.status).toBe(400);
      expect(mock.messages(MESSAGE_ID).map((message) => message.content)).toEqual(['hi']);
      expect(mock.writes()).toEqual([
        {kind: 'create_thread', target: `${CHANNEL_ID}/${MESSAGE_ID}`, payload: {name: 'hello'}},
        {kind: 'create_message', target: MESSAGE_ID, payload: {content: 'hi'}},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('lists the messages of a channel newest first and records each call', async () => {
    const {mock, call} = await arrange();
    mock.addMessage({
      id: '301',
      channel_id: CHANNEL_ID,
      content: 'second',
      author: {id: 'user-1', username: 'user'},
    });

    try {
      const list = await call('GET', `/channels/${CHANNEL_ID}/messages?limit=1`);

      expect((list.body as {id: string}[]).map((message) => message.id)).toEqual(['301']);
      expect(mock.calls).toEqual([
        {method: 'GET', path: `/channels/${CHANNEL_ID}/messages`, authorization: 'Bot test'},
      ]);
    } finally {
      await mock.stop();
    }
  });
});
