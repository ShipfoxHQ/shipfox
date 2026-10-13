import {NOTION_PAGE_RESULT_MARKER, startNotionApiMock} from './notion-api.js';

describe('Notion API mock', () => {
  it('fails fast when the endpoint omits a port', async () => {
    await expect(startNotionApiMock({endpoint: new URL('http://127.0.0.1')})).rejects.toThrow(
      'NOTION_API_BASE_URL must include an explicit port for the Notion API mock',
    );
  });

  it('allows an explicit port 0 for ephemeral test endpoints', async () => {
    const mock = await startNotionApiMock({endpoint: new URL('http://127.0.0.1:0')});

    try {
      const pageId = 'page-123';
      const response = await fetch(new URL(`/v1/pages/${pageId}`, mock.endpoint), {
        headers: {authorization: 'Bearer e2e-token'},
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({id: pageId, marker: NOTION_PAGE_RESULT_MARKER});
      expect(mock.calls).toEqual([{kind: 'get_page', authorization: 'Bearer e2e-token', pageId}]);
      expect(mock.writes()).toEqual([]);
    } finally {
      await mock.stop();
    }
  });

  describe('with a seeded page', () => {
    async function arrange() {
      const mock = await startNotionApiMock({endpoint: new URL('http://127.0.0.1:0')});
      mock.pages.set('page-1', {
        id: 'page-1',
        title: 'Fixture page',
        markdown: '# Fixture page',
        comments: [
          {id: 'comment-1', text: 'First'},
          {id: 'comment-2', text: 'Second'},
        ],
      });
      return mock;
    }

    it('serves the page with its title in the properties', async () => {
      const mock = await arrange();

      try {
        const page = await (await fetch(new URL('/v1/pages/page-1', mock.endpoint))).json();

        expect(page).toMatchObject({
          id: 'page-1',
          properties: {title: {type: 'title', title: [{plain_text: 'Fixture page'}]}},
        });
        expect(page).not.toHaveProperty('marker');
      } finally {
        await mock.stop();
      }
    });

    it('searches the pages by title, case-insensitively', async () => {
      const mock = await arrange();
      const search = async (body: unknown) =>
        (await (
          await fetch(new URL('/v1/search', mock.endpoint), {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(body),
          })
        ).json()) as {results: Array<{id: string}>; has_more: boolean; next_cursor: null};

      try {
        const found = await search({
          query: 'FIXTURE',
          page_size: 100,
          filter: {property: 'object', value: 'page'},
        });
        const none = await search({query: 'absent'});
        const dataSources = await search({filter: {property: 'object', value: 'data_source'}});

        expect(found).toMatchObject({
          results: [{id: 'page-1'}],
          has_more: false,
          next_cursor: null,
        });
        expect(none.results).toEqual([]);
        expect(dataSources.results).toEqual([]);
        expect(mock.writes()).toEqual([]);
      } finally {
        await mock.stop();
      }
    });

    it('serves the page content as Markdown, and the comments of the page', async () => {
      const mock = await arrange();

      try {
        const content = await (
          await fetch(new URL('/v1/pages/page-1/markdown', mock.endpoint))
        ).json();
        const comments = await (
          await fetch(new URL('/v1/comments?block_id=page-1', mock.endpoint))
        ).json();

        expect(content).toMatchObject({
          markdown: '# Fixture page',
          truncated: false,
          unknown_block_ids: [],
        });
        expect(comments).toMatchObject({
          results: [
            {id: 'comment-1', parent: {page_id: 'page-1'}, rich_text: [{plain_text: 'First'}]},
            {id: 'comment-2'},
          ],
          has_more: false,
        });
        expect(mock.calls.map((call) => call.kind)).toEqual(['get_page_content', 'get_comments']);
      } finally {
        await mock.stop();
      }
    });
  });

  describe('with writes', () => {
    interface Body {
      id: string;
      discussion_id: string;
      results: Array<{id: string; rich_text: Array<{plain_text: string}>}>;
    }

    async function arrange() {
      const mock = await startNotionApiMock({endpoint: new URL('http://127.0.0.1:0')});
      mock.pages.set('parent-1', {id: 'parent-1', title: 'Write parent'});
      const send = async (method: string, path: string, body: unknown) => {
        const response = await fetch(new URL(path, mock.endpoint), {
          method,
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(body),
        });
        return {status: response.status, body: (await response.json()) as Body};
      };
      const read = async (path: string) =>
        (await (await fetch(new URL(path, mock.endpoint))).json()) as Body;
      const title = (text: string) => ({title: {title: [{text: {content: text}}]}});
      return {mock, send, read, title};
    }

    it('creates a page under its parent that a read then shows', async () => {
      const {mock, send, read, title} = await arrange();

      try {
        const created = await send('POST', '/v1/pages', {
          parent: {page_id: 'parent-1'},
          properties: title('Contract page'),
          markdown: 'Created.',
        });
        const id = created.body.id;
        const page = await read(`/v1/pages/${id}`);
        const content = await read(`/v1/pages/${id}/markdown`);
        const found = (await (
          await fetch(new URL('/v1/search', mock.endpoint), {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({query: 'contract page'}),
          })
        ).json()) as Body;

        expect(created.status).toBe(200);
        expect(page).toMatchObject({
          id,
          parent: {type: 'page_id', page_id: 'parent-1'},
          properties: {title: {type: 'title', title: [{plain_text: 'Contract page'}]}},
        });
        expect(content).toMatchObject({markdown: 'Created.'});
        expect(found.results.map((result) => result.id)).toEqual([id]);
        expect(mock.writes()).toEqual([
          {
            kind: 'create_page',
            target: 'parent-1',
            payload: {
              parent: {page_id: 'parent-1'},
              properties: title('Contract page'),
              markdown: 'Created.',
            },
          },
        ]);
      } finally {
        await mock.stop();
      }
    });

    it('renames a page, replaces and appends its content, and rejects what it cannot apply', async () => {
      const {mock, send, read, title} = await arrange();

      try {
        const {body: created} = await send('POST', '/v1/pages', {
          parent: {page_id: 'parent-1'},
          properties: title('Contract page'),
          markdown: 'Created.',
        });
        const id = created.id;
        await send('PATCH', `/v1/pages/${id}`, {properties: title('Renamed')});
        const replaced = await send('PATCH', `/v1/pages/${id}/markdown`, {
          type: 'replace_content',
          replace_content: {new_str: 'Updated.'},
        });
        await send('PATCH', `/v1/pages/${id}/markdown`, {
          type: 'insert_content',
          insert_content: {content: 'More.', position: {type: 'end'}},
        });
        const invalid = await send('PATCH', `/v1/pages/${id}/markdown`, {type: 'unknown'});
        const missing = await send('PATCH', '/v1/pages/missing', {properties: title('Nope')});

        expect(await read(`/v1/pages/${id}`)).toMatchObject({
          properties: {title: {title: [{plain_text: 'Renamed'}]}},
        });
        expect(replaced.body).toMatchObject({object: 'page_markdown', markdown: 'Updated.'});
        expect(await read(`/v1/pages/${id}/markdown`)).toMatchObject({markdown: 'Updated.\nMore.'});
        expect(invalid.status).toBe(400);
        expect(missing).toMatchObject({status: 404, body: {code: 'object_not_found'}});
        expect(mock.writes().map((write) => write.kind)).toEqual([
          'create_page',
          'update_page',
          'update_page_content',
          'update_page_content',
        ]);
      } finally {
        await mock.stop();
      }
    });

    it('adds a comment to a page and a reply to its discussion, oldest first', async () => {
      const {mock, send, read} = await arrange();
      const text = (content: string) => [{type: 'text', text: {content}}];

      try {
        const first = await send('POST', '/v1/comments', {
          parent: {page_id: 'parent-1'},
          rich_text: text('First'),
        });
        const reply = await send('POST', '/v1/comments', {
          parent: {discussion_id: first.body.discussion_id},
          rich_text: text('Reply'),
        });
        const missing = await send('POST', '/v1/comments', {
          parent: {page_id: 'missing'},
          rich_text: text('Nope'),
        });
        const comments = await read('/v1/comments?block_id=parent-1');

        expect(reply.body.discussion_id).toBe(first.body.discussion_id);
        expect(missing.status).toBe(404);
        expect(comments.results.map((comment) => comment.rich_text[0]?.plain_text)).toEqual([
          'First',
          'Reply',
        ]);
        expect(mock.writes().map((write) => [write.kind, write.target])).toEqual([
          ['add_comment', 'parent-1'],
          ['add_comment', first.body.discussion_id],
        ]);
      } finally {
        await mock.stop();
      }
    });
  });

  describe('with a seeded data source', () => {
    async function arrange() {
      const mock = await startNotionApiMock({endpoint: new URL('http://127.0.0.1:0')});
      mock.dataSources.set('source-1', {
        id: 'source-1',
        rows: Array.from({length: 5}, (_, index) => ({
          id: `row-${index + 1}`,
          title: `Row ${index + 1}`,
        })),
      });
      const query = async (id: string, body: unknown) =>
        fetch(new URL(`/v1/data_sources/${id}/query`, mock.endpoint), {
          method: 'POST',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify(body),
        });
      return {mock, query};
    }

    it('pages the rows by cursor and ends with no cursor', async () => {
      const {mock, query} = await arrange();

      try {
        const first = (await (await query('source-1', {page_size: 3})).json()) as {
          next_cursor: string;
        };
        const second = await (await query('source-1', {start_cursor: first.next_cursor})).json();

        expect(first).toMatchObject({
          results: [{id: 'row-1'}, {id: 'row-2'}, {id: 'row-3'}],
          has_more: true,
          next_cursor: '3',
          type: 'page_or_data_source',
          page_or_data_source: {},
        });
        expect(second).toMatchObject({
          results: [{id: 'row-4'}, {id: 'row-5'}],
          has_more: false,
          next_cursor: null,
        });
        expect(mock.calls.map((call) => call.kind)).toEqual([
          'query_data_source',
          'query_data_source',
        ]);
        expect(mock.writes()).toEqual([]);
      } finally {
        await mock.stop();
      }
    });

    it('answers not found for a data source that was not seeded', async () => {
      const {mock, query} = await arrange();

      try {
        const response = await query('absent', {});

        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({code: 'object_not_found'});
      } finally {
        await mock.stop();
      }
    });

    it('rejects a cursor it did not issue', async () => {
      const {mock, query} = await arrange();

      try {
        const response = await query('source-1', {start_cursor: 'garbage'});

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({code: 'validation_error'});
      } finally {
        await mock.stop();
      }
    });
  });

  it('fails fast when the endpoint includes a path prefix', async () => {
    await expect(
      startNotionApiMock({endpoint: new URL('http://127.0.0.1:9000/notion')}),
    ).rejects.toThrow('NOTION_API_BASE_URL must not include a path for the Notion API mock');
  });

  it('answers a page read like Notion when asked to reject what no seed names', async () => {
    const mock = await startNotionApiMock({
      endpoint: new URL('http://127.0.0.1:0'),
      rejectUnseeded: true,
    });
    mock.pages.set('3f0c6baa-a59e-8196-b7be-c029ce003cdb', {
      id: '3f0c6baa-a59e-8196-b7be-c029ce003cdb',
      title: 'Fixture page',
      markdown: '',
      comments: [],
    });

    try {
      const read = (pageId: string) => fetch(new URL(`/v1/pages/${pageId}`, mock.endpoint));
      const seeded = await read('3f0c6baa-a59e-8196-b7be-c029ce003cdb');
      const missing = await read('00000000-0000-4000-8000-000000000000');
      const malformed = await read('not-a-uuid');

      expect(seeded.status).toBe(200);
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({code: 'object_not_found'});
      expect(malformed.status).toBe(400);
      await expect(malformed.json()).resolves.toMatchObject({code: 'validation_error'});
    } finally {
      await mock.stop();
    }
  });
});
