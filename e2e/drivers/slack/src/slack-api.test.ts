import {startSlackApiMock} from './slack-api.js';

describe('Slack API mock', () => {
  it('serves thread pages by cursor, known users, and permalinks', async () => {
    const mock = await startSlackApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      threadPages: {
        '': {messages: [{ts: '1.000100'}], nextCursor: 'next'},
        next: {messages: [{ts: '1.000200'}]},
      },
      users: {U1: {id: 'U1', name: 'one'}},
    });
    const post = (method: string, form: Record<string, string>) =>
      fetch(new URL(`/api/${method}`, mock.endpoint), {
        method: 'POST',
        headers: {authorization: 'Bearer xoxb-test'},
        body: new URLSearchParams(form),
      }).then((response) => response.json());

    try {
      const first = await post('conversations.replies', {channel: 'C1', ts: '1.000100'});
      const second = await post('conversations.replies', {
        channel: 'C1',
        ts: '1.000100',
        cursor: 'next',
      });
      const known = await post('users.info', {user: 'U1'});
      const unknown = await post('users.info', {user: 'U2'});
      const permalink = await post('chat.getPermalink', {channel: 'C1', message_ts: '1.000200'});

      expect(first).toEqual({
        ok: true,
        messages: [{ts: '1.000100'}],
        has_more: true,
        response_metadata: {next_cursor: 'next'},
      });
      expect(second).toMatchObject({has_more: false, response_metadata: {next_cursor: ''}});
      expect(known).toEqual({ok: true, user: {id: 'U1', name: 'one'}});
      expect(unknown).toEqual({ok: false, error: 'user_not_found'});
      expect(permalink).toMatchObject({
        ok: true,
        permalink: 'https://e2e.slack.com/archives/C1/p1000200',
      });
      expect(mock.calls.map((call) => call.kind)).toEqual([
        'conversations.replies',
        'conversations.replies',
        'users.info',
        'users.info',
        'chat.getPermalink',
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('records accepted posts as writes and leaves out rejected ones', async () => {
    const mock = await startSlackApiMock({endpoint: new URL('http://127.0.0.1:0')});
    const post = (form: Record<string, string>) =>
      fetch(new URL('/api/chat.postMessage', mock.endpoint), {
        method: 'POST',
        headers: {authorization: 'Bearer xoxb-test'},
        body: new URLSearchParams(form),
      }).then((response) => response.json());

    try {
      await post({channel: 'C1', thread_ts: '1.000100', text: 'accepted'});
      mock.setPostMessageError('channel_not_found');
      await post({channel: 'C1', text: 'rejected'});

      expect(mock.writes()).toEqual([
        {
          kind: 'chat.postMessage',
          target: 'C1',
          payload: {channel: 'C1', thread_ts: '1.000100', text: 'accepted'},
        },
      ]);
      expect(mock.calls).toHaveLength(2);
    } finally {
      await mock.stop();
    }
  });

  describe('seeded channels', () => {
    async function arrange() {
      const mock = await startSlackApiMock({endpoint: new URL('http://127.0.0.1:0')});
      mock.seedChannel({
        id: 'C1',
        name: 'read',
        topic: 'Reads',
        members: ['U1', 'U2', 'U3'],
        messages: [
          {ts: '1.000100', text: 'first'},
          {ts: '3.000100', text: 'third'},
          {ts: '2.000100', text: 'second'},
        ],
      });
      mock.seedChannel({id: 'C2', name: 'private', isPrivate: true, isArchived: true});
      const post = (method: string, form: Record<string, string>) =>
        fetch(new URL(`/api/${method}`, mock.endpoint), {
          method: 'POST',
          headers: {authorization: 'Bearer xoxb-test'},
          body: new URLSearchParams(form),
        }).then((response) => response.json() as Promise<Record<string, unknown>>);
      return {mock, post};
    }

    it('serves history newest first, a page at a time', async () => {
      const {mock, post} = await arrange();

      try {
        const first = await post('conversations.history', {channel: 'C1', limit: '2'});
        const second = await post('conversations.history', {
          channel: 'C1',
          limit: '2',
          cursor: 'offset:2',
        });
        const range = await post('conversations.history', {channel: 'C1', oldest: '1.5'});

        expect(first).toEqual({
          ok: true,
          messages: [
            {ts: '3.000100', text: 'third'},
            {ts: '2.000100', text: 'second'},
          ],
          has_more: true,
          pin_count: 0,
          response_metadata: {next_cursor: 'offset:2'},
        });
        expect(second).toEqual({
          ok: true,
          messages: [{ts: '1.000100', text: 'first'}],
          has_more: false,
          pin_count: 0,
        });
        expect(range).toMatchObject({messages: [{ts: '3.000100'}, {ts: '2.000100'}]});
      } finally {
        await mock.stop();
      }
    });

    it('serves channel info, with the member count only when asked', async () => {
      const {mock, post} = await arrange();

      try {
        const plain = await post('conversations.info', {channel: 'C1'});
        const counted = await post('conversations.info', {
          channel: 'C1',
          include_num_members: 'true',
        });

        expect(plain.channel).toMatchObject({
          id: 'C1',
          name: 'read',
          is_private: false,
          is_archived: false,
          topic: {value: 'Reads'},
        });
        expect(plain.channel).not.toHaveProperty('num_members');
        expect(counted.channel).toMatchObject({num_members: 3});
      } finally {
        await mock.stop();
      }
    });

    it('lists members and channels with Slack cursors', async () => {
      const {mock, post} = await arrange();

      try {
        const members = await post('conversations.members', {channel: 'C1', limit: '2'});
        const rest = await post('conversations.members', {
          channel: 'C1',
          limit: '2',
          cursor: 'offset:2',
        });
        const publicChannels = await post('conversations.list', {exclude_archived: 'true'});
        const everything = await post('conversations.list', {
          types: 'public_channel,private_channel',
          limit: '1',
        });

        expect(members).toEqual({
          ok: true,
          members: ['U1', 'U2'],
          response_metadata: {next_cursor: 'offset:2'},
        });
        expect(rest).toEqual({
          ok: true,
          members: ['U3'],
          response_metadata: {next_cursor: ''},
        });
        expect(publicChannels).toMatchObject({
          channels: [{id: 'C1', name: 'read', num_members: 3}],
          response_metadata: {next_cursor: ''},
        });
        expect(everything).toMatchObject({
          channels: [{id: 'C1'}],
          response_metadata: {next_cursor: 'offset:1'},
        });
      } finally {
        await mock.stop();
      }
    });

    it('answers channel_not_found and invalid_cursor like Slack', async () => {
      const {mock, post} = await arrange();

      try {
        expect(await post('conversations.history', {channel: 'C9'})).toEqual({
          ok: false,
          error: 'channel_not_found',
        });
        expect(await post('conversations.info', {})).toEqual({
          ok: false,
          error: 'channel_not_found',
        });
        expect(await post('conversations.members', {channel: 'C1', cursor: 'bogus'})).toEqual({
          ok: false,
          error: 'invalid_cursor',
        });
      } finally {
        await mock.stop();
      }
    });

    it('serves a seeded thread and user', async () => {
      const {mock, post} = await arrange();
      mock.seedThread({
        channel: 'C1',
        ts: '1.000100',
        messages: [{ts: '1.000100'}, {ts: '1.000200'}],
      });
      mock.seedUser({id: 'U1', name: 'one'});

      try {
        expect(await post('conversations.replies', {channel: 'C1', ts: '1.000100'})).toEqual({
          ok: true,
          messages: [{ts: '1.000100'}, {ts: '1.000200'}],
          has_more: false,
        });
        expect(await post('users.info', {user: 'U1'})).toEqual({
          ok: true,
          user: {id: 'U1', name: 'one'},
        });
      } finally {
        await mock.stop();
      }
    });
  });
});
