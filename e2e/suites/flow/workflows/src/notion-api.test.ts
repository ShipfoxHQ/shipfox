import {NOTION_PAGE_RESULT_MARKER, startNotionApiMock} from './notion-api.js';

describe('Notion API mock', () => {
  it('fails fast when the endpoint omits a port', async () => {
    await expect(startNotionApiMock(new URL('http://127.0.0.1'))).rejects.toThrow(
      'NOTION_API_BASE_URL must include an explicit port for the Notion API mock',
    );
  });

  it('allows an explicit port 0 for ephemeral test endpoints', async () => {
    const mock = await startNotionApiMock(new URL('http://127.0.0.1:0'));

    try {
      const pageId = 'page-123';
      const response = await fetch(new URL(`/v1/pages/${pageId}`, mock.endpoint), {
        headers: {authorization: 'Bearer e2e-token'},
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({id: pageId, marker: NOTION_PAGE_RESULT_MARKER});
      expect(mock.calls).toEqual([{kind: 'get_page', authorization: 'Bearer e2e-token', pageId}]);
    } finally {
      await mock.stop();
    }
  });

  it('fails fast when the endpoint includes a path prefix', async () => {
    await expect(startNotionApiMock(new URL('http://127.0.0.1:9000/notion'))).rejects.toThrow(
      'NOTION_API_BASE_URL must not include a path for the Notion API mock',
    );
  });
});
