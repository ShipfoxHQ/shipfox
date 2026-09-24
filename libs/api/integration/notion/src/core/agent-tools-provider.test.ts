import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import type {NotionAgentToolId} from '@shipfox/api-integration-notion-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import type {NotionAgentToolsClient} from '#api/client.js';
import {
  notionAgentToolCatalog,
  notionAgentToolSelectionCatalog,
  splitCommentText,
} from './agent-tools.js';
import {NotionAgentToolsProvider} from './agent-tools-provider.js';
import {NotionIntegrationProviderError} from './errors.js';

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

function catalogTool(id: NotionAgentToolId) {
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

describe('splitCommentText', () => {
  it('keeps non-BMP characters intact while respecting the UTF-16 boundary', () => {
    const prefix = 'a'.repeat(1_999);
    const text = `${prefix}😀b`;

    const chunks = splitCommentText(text);

    expect(chunks).toEqual([prefix, '😀b']);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2_000);
      expect(() => encodeURIComponent(chunk)).not.toThrow();
    }
  });
});

describe('NotionAgentToolsProvider', () => {
  it('publishes eight standalone tools with writes marked as sensitive', () => {
    const provider = new NotionAgentToolsProvider(providerOptions());

    expect(provider.catalog()).toBe(notionAgentToolCatalog);
    expect(provider.selectionCatalog()).toBe(notionAgentToolSelectionCatalog);
    expect(notionAgentToolCatalog).toHaveLength(8);
    expect(notionAgentToolSelectionCatalog.selectors).toEqual(
      notionAgentToolCatalog.map((tool) => ({
        token: tool.id,
        kind: 'standalone',
        sensitivity: tool.sensitivity,
        sensitive: false,
      })),
    );
    expect(notionAgentToolCatalog.filter((tool) => tool.sensitivity === 'write')).toHaveLength(3);
  });

  it.each([
    {
      toolId: 'search',
      arguments: {query: 'Roadmap'},
      body: {
        object: 'list',
        results: [{object: 'page', id: '101c6baa-a59e-8036-9020-c778471a1962'}],
        next_cursor: '13dc6baa-a59e-803c-bb76-e49a29484e23',
        has_more: true,
        type: 'page_or_data_source',
        page_or_data_source: {},
        request_id: '8c71a1bf-3d41-4965-8501-001c80cb6752',
      },
    },
    {
      toolId: 'query_data_source',
      arguments: {data_source_id: 'data-source-1'},
      body: {
        object: 'list',
        results: [{object: 'page', id: 'page-1'}],
        next_cursor: null,
        has_more: false,
        type: 'page_or_data_source',
        page_or_data_source: {},
      },
    },
    {
      toolId: 'get_comments',
      arguments: {block_id: 'page-1'},
      body: {
        object: 'list',
        results: [{object: 'comment', id: 'comment-1'}],
        next_cursor: null,
        has_more: false,
        type: 'comment',
        comment: {},
        request_status: {type: 'complete'},
      },
    },
    {
      toolId: 'get_page_content',
      arguments: {page_id: 'page-1'},
      body: {
        object: 'page_markdown',
        id: 'page-1',
        markdown: '# Roadmap',
        truncated: false,
        unknown_block_ids: [],
      },
    },
  ] as const)('accepts Notion $toolId response without dropping provider fields', async ({
    toolId,
    arguments: arguments_,
    body,
  }) => {
    const options = providerOptions(async () => ({status: 200, body}));
    const provider = new NotionAgentToolsProvider(options);
    const tool = catalogTool(toolId);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: [tool],
      scope: {},
    });

    const result = await session.call({toolId, arguments: arguments_});
    const validate = new AjvJsonSchemaValidator().getValidator(
      tool.outputSchema as Parameters<AjvJsonSchemaValidator['getValidator']>[0],
    );

    expect(result.structuredContent).toEqual(body);
    expect(validate(result.structuredContent)).toMatchObject({valid: true});
  });

  it('keeps catalog output schemas open for provider fields', () => {
    for (const tool of notionAgentToolCatalog) {
      expect(tool.outputSchema).toMatchObject({additionalProperties: true});
    }
  });

  it('checks declared pagination fields while allowing other response fields', () => {
    const tool = catalogTool('search');
    const validate = new AjvJsonSchemaValidator().getValidator(
      tool.outputSchema as Parameters<AjvJsonSchemaValidator['getValidator']>[0],
    );

    expect(
      validate({results: [], next_cursor: null, has_more: false, request_id: 'request-1'}).valid,
    ).toBe(true);
    expect(validate({results: {}, next_cursor: null, has_more: false}).valid).toBe(false);
    expect(validate({results: [], next_cursor: 1, has_more: false}).valid).toBe(false);
    expect(validate({results: [], next_cursor: null, has_more: 'false'}).valid).toBe(false);
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
      body: {
        query: 'Roadmap',
        page_size: 100,
        start_cursor: 'search-cursor',
        filter: {property: 'object', value: 'page'},
      },
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

  it('builds create, update, and comment write requests', async () => {
    const options = providerOptions(async () => ({status: 200, body: {id: 'page-1'}}));
    const provider = new NotionAgentToolsProvider(options);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: notionAgentToolCatalog,
      scope: {},
    });

    await session.call({
      toolId: 'create_page',
      arguments: {
        parent: {page_id: 'https://www.notion.so/Parent-2e6f8a3e0000400080005d2b7e9a1c11'},
        properties: {Name: {title: [{text: {content: 'Child'}}]}},
        markdown: '# Body',
      },
    });
    await session.call({
      toolId: 'update_page',
      arguments: {
        page_id: 'page-1',
        properties: {Status: {status: {name: 'Done'}}},
        markdown: 'More',
        mode: 'append',
      },
    });
    await session.call({
      toolId: 'add_comment',
      arguments: {page_id: 'page-1', text: 'a'.repeat(2_001)},
    });

    expect(options.notion.request).toHaveBeenNthCalledWith(1, {
      accessToken: 'notion-token',
      method: 'POST',
      path: '/v1/pages',
      body: {
        parent: {page_id: '2e6f8a3e-0000-4000-8000-5d2b7e9a1c11'},
        properties: {Name: {title: [{text: {content: 'Child'}}]}},
        markdown: '# Body',
      },
      operation: 'create_page',
    });
    expect(options.notion.request).toHaveBeenNthCalledWith(2, {
      accessToken: 'notion-token',
      method: 'PATCH',
      path: '/v1/pages/page-1',
      body: {properties: {Status: {status: {name: 'Done'}}}},
      operation: 'update_page',
    });
    expect(options.notion.request).toHaveBeenNthCalledWith(3, {
      accessToken: 'notion-token',
      method: 'PATCH',
      path: '/v1/pages/page-1/markdown',
      body: {markdown: 'More', mode: 'append'},
      operation: 'update_page',
    });
    expect(options.notion.request).toHaveBeenNthCalledWith(4, {
      accessToken: 'notion-token',
      method: 'POST',
      path: '/v1/comments',
      body: {
        parent: {page_id: 'page-1'},
        rich_text: [
          {type: 'text', text: {content: 'a'.repeat(2_000)}},
          {type: 'text', text: {content: 'a'}},
        ],
      },
      operation: 'add_comment',
    });
  });

  it('validates write-specific arguments before making a request', async () => {
    const options = providerOptions();
    const provider = new NotionAgentToolsProvider(options);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: notionAgentToolCatalog,
      scope: {},
    });

    const invalidUpdate = await session.call({
      toolId: 'update_page',
      arguments: {page_id: 'page-1'},
    });
    const invalidComment = await session.call({
      toolId: 'add_comment',
      arguments: {text: 'Reply without a parent'},
    });

    expect(invalidUpdate).toMatchObject({
      isError: true,
      structuredContent: {code: 'invalid-request'},
    });
    expect(invalidComment).toMatchObject({
      isError: true,
      structuredContent: {code: 'invalid-request'},
    });
    expect(options.notion.request).not.toHaveBeenCalled();
  });

  it('reports a partial update when content fails after properties', async () => {
    const options = providerOptions();
    options.notion.request
      .mockResolvedValueOnce({status: 200, body: {id: 'page-1'}})
      .mockRejectedValueOnce(
        new NotionIntegrationProviderError(
          'provider-unavailable',
          'Notion request failed',
          undefined,
          503,
        ),
      );
    const provider = new NotionAgentToolsProvider(options);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: notionAgentToolCatalog,
      scope: {},
    });

    const result = await session.call({
      toolId: 'update_page',
      arguments: {
        page_id: 'page-1',
        properties: {Status: {status: {name: 'Done'}}},
        markdown: 'Body',
        mode: 'replace',
      },
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        code: 'provider-unavailable',
        status: 503,
        properties_updated: true,
        content_updated: false,
      },
    });
    expect(options.notion.request).toHaveBeenCalledTimes(2);
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

  it('refreshes once after a 401 and retries successfully', async () => {
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

  it('maps a terminal 401 after refresh to credentials-unavailable', async () => {
    const options = providerOptions(async () => ({status: 401, body: {code: 'unauthorized'}}));
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

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {code: 'credentials-unavailable', status: 401},
    });
    expect(options.notion.request).toHaveBeenCalledTimes(2);
  });

  it('maps a rejected token refresh to credentials-unavailable', async () => {
    const options = providerOptions(async () => ({status: 401, body: {code: 'unauthorized'}}));
    options.tokenStore.getAccessToken
      .mockResolvedValueOnce('stale-token')
      .mockRejectedValueOnce(new Error('token store unavailable'));
    const provider = new NotionAgentToolsProvider(options);
    const session = await provider.openSession({
      connection: notionConnection(),
      tools: [catalogTool('get_page_content')],
      scope: {},
    });

    const result = await session.call({toolId: 'get_page_content', arguments: {page_id: 'page-1'}});

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {code: 'credentials-unavailable', status: 401},
    });
    expect(options.notion.request).toHaveBeenCalledTimes(1);
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
