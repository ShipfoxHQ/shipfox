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

  it('lists the channels of a server without threads, and its active threads apart', async () => {
    const {mock, call} = await arrange();
    mock.addChannel({id: '201', type: 11, guild_id: GUILD_ID, parent_id: CHANNEL_ID, name: 'talk'});
    mock.addChannel({id: '900', type: 0, guild_id: 'other-guild', name: 'elsewhere'});

    try {
      const channels = await call('GET', `/guilds/${GUILD_ID}/channels`);
      const threads = await call('GET', `/guilds/${GUILD_ID}/threads/active`);

      expect(channels.body).toEqual([{id: CHANNEL_ID, type: 0, guild_id: GUILD_ID}]);
      expect(threads.body).toMatchObject({threads: [{id: '201', type: 11}], members: []});
    } finally {
      await mock.stop();
    }
  });

  it('searches the messages of a server, newest first, flagging each hit', async () => {
    const {mock, call} = await arrange();
    mock.addMessage({
      id: '301',
      channel_id: CHANNEL_ID,
      content: 'Hello again',
      author: {id: 'user-2', username: 'other'},
    });
    mock.addChannel({id: '900', type: 0, guild_id: 'other-guild'});
    mock.addMessage({
      id: '901',
      channel_id: '900',
      content: 'hello elsewhere',
      author: {id: 'user-1', username: 'user'},
    });

    try {
      const all = await call('GET', `/guilds/${GUILD_ID}/messages/search?content=HELLO`);
      const paged = await call(
        'GET',
        `/guilds/${GUILD_ID}/messages/search?content=hello&limit=1&offset=1`,
      );
      const byAuthor = await call(
        'GET',
        `/guilds/${GUILD_ID}/messages/search?content=hello&channel_id=${CHANNEL_ID}&author_id=user-2`,
      );

      expect(all.body).toMatchObject({
        total_results: 2,
        messages: [[{id: '301', hit: true}], [{id: MESSAGE_ID, hit: true}]],
      });
      expect(paged.body).toMatchObject({total_results: 2, messages: [[{id: MESSAGE_ID}]]});
      expect(byAuthor.body).toMatchObject({total_results: 1, messages: [[{id: '301'}]]});
    } finally {
      await mock.stop();
    }
  });

  it('orders search matches by time across channels', async () => {
    const {mock, call} = await arrange();
    mock.addChannel({id: '202', type: 0, guild_id: GUILD_ID});
    const author = {id: 'user-1', username: 'user'};
    // The older message is in the channel the fake lists last, so grouping by channel gets it wrong.
    mock.addMessage({id: '401', channel_id: '202', content: 'match', author});
    await new Promise((resolve) => setTimeout(resolve, 5));
    mock.addMessage({id: '400', channel_id: CHANNEL_ID, content: 'match', author});

    try {
      const result = await call('GET', `/guilds/${GUILD_ID}/messages/search?content=match`);

      expect(
        (result.body as {messages: {id: string}[][]}).messages.map(([hit]) => hit?.id),
      ).toEqual(['400', '401']);
    } finally {
      await mock.stop();
    }
  });

  it('answers a member of the server, and 404 for one it does not know', async () => {
    const {mock, call} = await arrange();
    mock.addMember({guildId: GUILD_ID, member: {user: {id: 'user-1', username: 'user'}}});

    try {
      const member = await call('GET', `/guilds/${GUILD_ID}/members/user-1`);
      const otherGuild = await call('GET', '/guilds/other-guild/members/user-1');

      expect(member.body).toMatchObject({
        user: {id: 'user-1', username: 'user', global_name: null},
        nick: null,
        roles: [],
        joined_at: expect.any(String),
      });
      expect(otherGuild).toEqual({status: 404, body: {message: 'Unknown Member', code: 10_007}});
    } finally {
      await mock.stop();
    }
  });
});
