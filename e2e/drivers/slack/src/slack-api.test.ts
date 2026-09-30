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
});
