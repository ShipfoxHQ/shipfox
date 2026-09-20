import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {NotionAgentToolsClient} from '#api/client.js';
import {notionAgentToolCatalog, notionAgentToolSelectionCatalog} from './agent-tools.js';
import {NotionAgentToolsProvider} from './agent-tools-provider.js';

function notionConnection(
  overrides: Partial<IntegrationConnection<'notion'>> = {},
): IntegrationConnection<'notion'> {
  const now = new Date();
  return {
    id: 'notion-connection-1',
    workspaceId: 'workspace-1',
    provider: 'notion',
    externalAccountId: 'notion-workspace-1',
    slug: 'notion-acme',
    displayName: 'Notion Acme',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    repositoryAccessMode: 'selected',
    ...overrides,
  };
}

function catalogTool(id: 'get_page' | 'get_page_content') {
  const tool = notionAgentToolCatalog.find((candidate) => candidate.id === id);
  if (!tool) throw new Error(`Unknown test tool: ${id}`);
  return tool;
}

function providerOptions(
  request: NotionAgentToolsClient['request'] = async () => ({status: 200, body: {ok: true}}),
) {
  return {
    notion: {request: vi.fn(request)},
    tokenStore: {getAccessToken: vi.fn().mockResolvedValue('notion-token')},
  };
}

describe('NotionAgentToolsProvider', () => {
  it('publishes five standalone read tools', () => {
    const provider = new NotionAgentToolsProvider(providerOptions());

    expect(provider.catalog()).toBe(notionAgentToolCatalog);
    expect(provider.selectionCatalog()).toBe(notionAgentToolSelectionCatalog);
    expect(notionAgentToolSelectionCatalog.selectors).toEqual(
      notionAgentToolCatalog.map((tool) => ({
        token: tool.id,
        kind: 'standalone',
        sensitivity: 'read',
        sensitive: false,
      })),
    );
  });

  it('builds the five REST requests and preserves pagination results', async () => {
    const options = providerOptions(async (request) => ({
      status: 200,
      body: {
        request: request.operation,
        results: [],
        next_cursor: 'next-page',
        has_more: true,
      },
    }));
    const provider = new NotionAgentToolsProvider(options);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: notionAgentToolCatalog,
      scope: {},
    });

    await session.call({
      toolId: 'search',
      arguments: {query: 'Roadmap', object: 'page', page_size: 100, cursor: 'search-cursor'},
    });
    await session.call({
      toolId: 'get_page',
      arguments: {page_id: 'https://www.notion.so/Page-2e6f8a3e0000400080005d2b7e9a1c11'},
    });
    await session.call({
      toolId: 'get_page_content',
      arguments: {page_id: 'page-123'},
    });
    await session.call({
      toolId: 'query_data_source',
      arguments: {
        data_source_id: 'data-source-123',
        filter: {property: 'Status'},
        sorts: [{property: 'Name', direction: 'ascending'}],
        page_size: 25,
        cursor: 'query-cursor',
      },
    });
    const comments = await session.call({
      toolId: 'get_comments',
      arguments: {block_id: 'page-123', cursor: 'comment-cursor'},
    });

    expect(options.notion.request).toHaveBeenNthCalledWith(1, {
      accessToken: 'notion-token',
      method: 'POST',
      path: '/v1/search',
      body: {query: 'Roadmap', object: 'page', page_size: 100, start_cursor: 'search-cursor'},
      operation: 'search',
    });
    expect(options.notion.request).toHaveBeenNthCalledWith(2, {
      accessToken: 'notion-token',
      method: 'GET',
      path: '/v1/pages/2e6f8a3e-0000-4000-8000-5d2b7e9a1c11',
      operation: 'get_page',
    });
    expect(options.notion.request).toHaveBeenNthCalledWith(3, {
      accessToken: 'notion-token',
      method: 'GET',
      path: '/v1/pages/page-123/markdown',
      operation: 'get_page_content',
    });
    expect(options.notion.request).toHaveBeenNthCalledWith(4, {
      accessToken: 'notion-token',
      method: 'POST',
      path: '/v1/data_sources/data-source-123/query',
      body: {
        filter: {property: 'Status'},
        sorts: [{property: 'Name', direction: 'ascending'}],
        page_size: 25,
        start_cursor: 'query-cursor',
      },
      operation: 'query_data_source',
    });
    expect(options.notion.request).toHaveBeenNthCalledWith(5, {
      accessToken: 'notion-token',
      method: 'GET',
      path: '/v1/comments',
      query: {block_id: 'page-123', start_cursor: 'comment-cursor'},
      operation: 'get_comments',
    });
    expect(comments.structuredContent).toMatchObject({next_cursor: 'next-page', has_more: true});
  });

  it('maps a page title and rejects invalid arguments before making a request', async () => {
    const options = providerOptions(async () => ({
      status: 200,
      body: {
        id: 'page-1',
        properties: {
          Name: {type: 'title', title: [{plain_text: 'Project plan'}]},
        },
      },
    }));
    const provider = new NotionAgentToolsProvider(options);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: [catalogTool('get_page')],
      scope: {},
    });

    const page = await session.call({toolId: 'get_page', arguments: {page_id: 'page-1'}});
    const invalid = await session.call({
      toolId: 'get_page',
      arguments: {page_id: 'page-1', unexpected: true},
    });

    expect(page.structuredContent).toMatchObject({id: 'page-1', title: 'Project plan'});
    expect(invalid).toMatchObject({
      isError: true,
      content: [{type: 'text', text: 'Unknown parameter: unexpected'}],
      structuredContent: {code: 'invalid-request'},
    });
    expect(options.notion.request).toHaveBeenCalledTimes(1);
  });

  it('refreshes once after a 401 and maps the terminal error', async () => {
    const options = providerOptions(async ({accessToken}) =>
      accessToken === 'stale-token'
        ? {status: 401, body: {code: 'unauthorized'}}
        : {status: 200, body: {markdown: '# Read me', truncated: false, unknown_block_ids: []}},
    );
    options.tokenStore.getAccessToken
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');
    const provider = new NotionAgentToolsProvider(options);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: [catalogTool('get_page_content')],
      scope: {},
    });

    const result = await session.call({toolId: 'get_page_content', arguments: {page_id: 'page-1'}});

    expect(result.structuredContent).toMatchObject({markdown: '# Read me'});
    expect(options.tokenStore.getAccessToken).toHaveBeenNthCalledWith(2, {
      connectionId: 'notion-connection-1',
      forceRefresh: true,
    });
  });

  it.each([
    [403, {}, 'The Notion page is not shared with the Shipfox connection.', 'access-denied'],
    [
      404,
      {code: 'object_not_found'},
      'The Notion page is not shared with the Shipfox connection.',
      'access-denied',
    ],
  ] as const)('maps provider failures', async (status, body, message, code) => {
    const options = providerOptions(async () => ({status, body}));
    const provider = new NotionAgentToolsProvider(options);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: [catalogTool('get_page')],
      scope: {},
    });

    const result = await session.call({toolId: 'get_page', arguments: {page_id: 'page-1'}});

    expect(result).toMatchObject({
      isError: true,
      content: [{type: 'text', text: message}],
      structuredContent: {code},
    });
  });
});
