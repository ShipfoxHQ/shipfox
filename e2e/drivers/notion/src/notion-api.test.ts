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
});
