import {startClickUpApiMock} from './clickup-api.js';

describe('ClickUp API mock', () => {
  it('fails fast when the endpoint omits a port', async () => {
    await expect(startClickUpApiMock(new URL('http://127.0.0.1'))).rejects.toThrow(
      'CLICKUP_API_BASE_URL must include an explicit port for the ClickUp API mock',
    );
  });

  it('allows an explicit port 0 for ephemeral test endpoints', async () => {
    const mock = await startClickUpApiMock(new URL('http://127.0.0.1:0'));

    try {
      expect(mock.endpoint.port).not.toBe('0');
    } finally {
      await mock.stop();
    }
  });

  it('records comments as writes and reads as calls only', async () => {
    const mock = await startClickUpApiMock(new URL('http://127.0.0.1:0'));

    try {
      await fetch(new URL('/api/v2/task/86abc', mock.endpoint));
      await fetch(new URL('/api/v2/task/86abc/comment', mock.endpoint), {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({comment_text: 'Done', notify_all: false}),
      });

      expect(mock.calls.map((call) => call.kind)).toEqual(['get_task', 'add_comment']);
      expect(mock.writes()).toEqual([
        {kind: 'add_comment', target: '86abc', payload: {comment_text: 'Done', notify_all: false}},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('serves a fixture task and records a status update as a write', async () => {
    const mock = await startClickUpApiMock(new URL('http://127.0.0.1:0'), {
      tasks: [
        {
          id: '86abc',
          name: 'Add a --json flag',
          url: 'https://app.clickup.com/t/86abc',
          markdownDescription: 'Scripts need JSON.',
        },
      ],
    });

    try {
      const task = await (await fetch(new URL('/api/v2/task/86abc', mock.endpoint))).json();
      const update = await fetch(new URL('/api/v2/task/86abc', mock.endpoint), {
        method: 'PUT',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({status: 'in progress'}),
      });

      expect(task).toEqual({
        id: '86abc',
        name: 'Add a --json flag',
        url: 'https://app.clickup.com/t/86abc',
        markdown_description: 'Scripts need JSON.',
      });
      expect(update.status).toBe(200);
      expect(mock.writes()).toEqual([
        {kind: 'update_task', target: '86abc', payload: {status: 'in progress'}},
      ]);
    } finally {
      await mock.stop();
    }
  });

  it('fails fast when the endpoint includes a path prefix', async () => {
    await expect(startClickUpApiMock(new URL('http://127.0.0.1:9000/clickup'))).rejects.toThrow(
      'CLICKUP_API_BASE_URL must not include a path for the ClickUp API mock',
    );
  });

  it('logs malformed requests before returning a bounded error', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const mock = await startClickUpApiMock(new URL('http://127.0.0.1:0'));

    try {
      const response = await fetch(new URL('/api/v2/task/e2e/comment', mock.endpoint), {
        method: 'POST',
        body: '{',
      });

      expect(response.status).toBe(400);
      expect(stderrWrite).toHaveBeenCalledWith(
        expect.stringContaining('ClickUp API mock request failed: SyntaxError:'),
      );
    } finally {
      stderrWrite.mockRestore();
      await mock.stop();
    }
  });
});
