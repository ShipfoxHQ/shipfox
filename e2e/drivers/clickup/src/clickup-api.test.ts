import {type ClickUpTaskFixture, startClickUpApiMock} from './clickup-api.js';

describe('ClickUp API mock', () => {
  it('fails fast when the endpoint omits a port', async () => {
    await expect(startClickUpApiMock({endpoint: new URL('http://127.0.0.1')})).rejects.toThrow(
      'CLICKUP_API_BASE_URL must include an explicit port for the ClickUp API mock',
    );
  });

  it('allows an explicit port 0 for ephemeral test endpoints', async () => {
    const mock = await startClickUpApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      expect(mock.endpoint.port).not.toBe('0');
    } finally {
      await mock.stop();
    }
  });

  it('records comments as writes and reads as calls only', async () => {
    const mock = await startClickUpApiMock({endpoint: new URL('http://127.0.0.1:0')});

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
    const mock = await startClickUpApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
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

  describe('with a seeded list', () => {
    const list = {id: 'list-1', name: 'Contracts read'};
    const task = (id: string, extra: Partial<ClickUpTaskFixture> = {}): ClickUpTaskFixture => ({
      id,
      name: `Task ${id}`,
      url: `https://app.clickup.com/t/${id}`,
      markdownDescription: '',
      list,
      ...extra,
    });

    async function arrange(tasks: ClickUpTaskFixture[]) {
      const mock = await startClickUpApiMock({endpoint: new URL('http://127.0.0.1:0')});
      for (const seeded of tasks) mock.tasks.set(seeded.id, seeded);
      const search = async (query: string) =>
        (await (
          await fetch(new URL(`/api/v2/team/team-1/task?${query}`, mock.endpoint))
        ).json()) as {
          tasks: Array<{id: string; list: {id: string}}>;
          last_page: boolean;
        };
      return {mock, search};
    }

    it('searches the tasks of a list, a page of 100 at a time', async () => {
      const {mock, search} = await arrange([
        ...Array.from({length: 101}, (_, index) => task(`t${index}`)),
        task('elsewhere', {list: {id: 'list-2', name: 'Other'}}),
      ]);

      try {
        const first = await search('list_ids[]=list-1&page=0');
        const second = await search('list_ids[]=list-1&page=1');

        expect(first.tasks).toHaveLength(100);
        expect(first.tasks[0]).toMatchObject({id: 't0', list: {id: 'list-1'}});
        expect(first.last_page).toBe(false);
        expect(second.tasks.map((found) => found.id)).toEqual(['t100']);
        expect(second.last_page).toBe(true);
        expect(mock.calls.map((call) => call.kind)).toEqual(['search_tasks', 'search_tasks']);
        expect(mock.writes()).toEqual([]);
      } finally {
        await mock.stop();
      }
    });

    it('leaves closed tasks and subtasks out unless the search asks for them', async () => {
      const {mock, search} = await arrange([
        task('open'),
        task('closed', {closed: true}),
        task('sub', {parentId: 'open'}),
      ]);

      try {
        const plain = await search('list_ids[]=list-1');
        const all = await search('list_ids[]=list-1&include_closed=true&subtasks=true');

        expect(plain.tasks.map((found) => found.id)).toEqual(['open']);
        expect(all.tasks.map((found) => found.id)).toEqual(['open', 'closed', 'sub']);
      } finally {
        await mock.stop();
      }
    });

    it('serves the list of a task and the first page of its comments', async () => {
      const comments = Array.from({length: 32}, (_, index) => ({
        id: `c${index}`,
        text: `Comment ${index}`,
      }));
      const {mock} = await arrange([task('t1', {comments})]);

      try {
        const found = await (await fetch(new URL('/api/v2/task/t1', mock.endpoint))).json();
        const page = (await (
          await fetch(new URL('/api/v2/task/t1/comment', mock.endpoint))
        ).json()) as {comments: Array<{id: string; comment_text: string}>};
        const none = await (
          await fetch(new URL('/api/v2/task/other/comment', mock.endpoint))
        ).json();

        expect(found).toMatchObject({id: 't1', list: {id: 'list-1', name: 'Contracts read'}});
        expect(page.comments).toHaveLength(25);
        expect(page.comments[0]).toMatchObject({id: 'c0', comment_text: 'Comment 0'});
        expect(none).toEqual({comments: []});
      } finally {
        await mock.stop();
      }
    });
  });

  it('fails fast when the endpoint includes a path prefix', async () => {
    await expect(
      startClickUpApiMock({endpoint: new URL('http://127.0.0.1:9000/clickup')}),
    ).rejects.toThrow('CLICKUP_API_BASE_URL must not include a path for the ClickUp API mock');
  });

  it('logs malformed requests before returning a bounded error', async () => {
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const mock = await startClickUpApiMock({endpoint: new URL('http://127.0.0.1:0')});

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
