import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

export const NOTION_PAGE_RESULT_MARKER = 'notion-page-result-marker';

const NOTION_PAGE_PATH_RE = /^\/v1\/pages\/([^/]+)$/;
const NOTION_PAGE_MARKDOWN_PATH_RE = /^\/v1\/pages\/([^/]+)\/markdown$/;
const NOTION_DATA_SOURCE_QUERY_PATH_RE = /^\/v1\/data_sources\/([^/]+)\/query$/;
const NOTION_SEARCH_PATH = '/v1/search';
const NOTION_COMMENTS_PATH = '/v1/comments';
const NOTION_PAGE_SIZE = 100;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;

/** A page the fake serves, in the shape the tools read. */
export interface NotionPageFixture {
  id: string;
  title: string;
  /** What `get_page_content` returns. */
  markdown?: string | undefined;
  /** Oldest first. */
  comments?: readonly {id: string; text: string}[] | undefined;
}

/** A data source the fake serves. A query returns its rows as pages, in order. */
export interface NotionDataSourceFixture {
  id: string;
  rows: readonly NotionPageFixture[];
}

export type NotionApiMockCall =
  | {kind: 'get_page'; authorization: string | undefined; pageId: string}
  | {kind: 'get_page_content'; authorization: string | undefined; pageId: string}
  | {kind: 'get_comments'; authorization: string | undefined; blockId: string}
  | {
      kind: 'query_data_source';
      authorization: string | undefined;
      dataSourceId: string;
      body: {page_size?: number; start_cursor?: string};
    }
  | {
      kind: 'search';
      authorization: string | undefined;
      body: {query?: string; filter?: unknown; page_size?: number};
    };

export interface NotionApiMock {
  calls: NotionApiMockCall[];
  /** The pages the fake serves, by ID. Add to it to seed the fake after it started. */
  pages: Map<string, NotionPageFixture>;
  /** The data sources the fake serves, by ID. A data source that was not seeded answers not found. */
  dataSources: Map<string, NotionDataSourceFixture>;
  endpoint: URL;
  /** Writes the fake accepted. The fake serves reads only, so this stays empty. */
  writes(): RecordedWrite[];
  stop(): Promise<void>;
}

export interface NotionApiMockOptions {
  /**
   * The access token the API presents, from the connection the spec creates. The fake shares the
   * stack's Notion address with other specs and answers the requests that carry this token.
   */
  accessToken?: string | undefined;
  /** Listens here directly instead of behind the stack's router. Unit tests pass port 0. */
  endpoint?: URL | undefined;
}

export async function startNotionApiMock(
  options: NotionApiMockOptions = {},
): Promise<NotionApiMock> {
  const configuredEndpoint = options.endpoint ?? new URL(requiredNotionApiBaseUrl());
  validateEndpoint(configuredEndpoint);
  const calls: NotionApiMockCall[] = [];
  const pages = new Map<string, NotionPageFixture>();
  const dataSources = new Map<string, NotionDataSourceFixture>();
  let boundEndpoint = configuredEndpoint;
  const server = createServer((request, response) => {
    void handleNotionRequest({
      calls,
      pages,
      dataSources,
      endpoint: boundEndpoint,
      request,
      response,
    }).catch((error) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      process.stderr.write(
        `Notion API mock request failed: ${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}\n`,
      );
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent)
        sendJson(response, 400, {code: 'E2E_BAD_REQUEST', message: 'Invalid Notion request'});
      else response.end();
    });
  });

  let listening: ListeningFake;
  try {
    listening = await listenFake({
      server,
      endpoint: options.endpoint,
      stackEndpoint: () => configuredEndpoint,
      credentials: [options.accessToken],
    });
  } catch (error) {
    throw new Error(`Notion API mock failed to start at ${configuredEndpoint}`, {cause: error});
  }
  boundEndpoint = listening.endpoint;

  return {
    calls,
    pages,
    dataSources,
    endpoint: boundEndpoint,
    writes: () => [],
    stop: async () => {
      try {
        await listening.close();
      } catch (error) {
        throw new Error(`Notion API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

/** The method the fake serves at `path`, or undefined for a path it does not serve. */
function notionMethod(path: string): 'GET' | 'POST' | undefined {
  if (path === NOTION_SEARCH_PATH || NOTION_DATA_SOURCE_QUERY_PATH_RE.test(path)) return 'POST';
  const serveGet =
    NOTION_PAGE_PATH_RE.test(path) ||
    NOTION_PAGE_MARKDOWN_PATH_RE.test(path) ||
    path === NOTION_COMMENTS_PATH;
  return serveGet ? 'GET' : undefined;
}

async function handleNotionRequest(params: {
  calls: NotionApiMockCall[];
  pages: ReadonlyMap<string, NotionPageFixture>;
  dataSources: ReadonlyMap<string, NotionDataSourceFixture>;
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const {calls, pages, dataSources, request, response} = params;
  const requestUrl = new URL(request.url ?? '/', params.endpoint);
  const authorization = request.headers.authorization;
  const path = requestUrl.pathname;

  const pageMatch = path.match(NOTION_PAGE_PATH_RE);
  const markdownMatch = path.match(NOTION_PAGE_MARKDOWN_PATH_RE);
  const queryMatch = path.match(NOTION_DATA_SOURCE_QUERY_PATH_RE);
  const expectedMethod = notionMethod(path);
  if (expectedMethod === undefined) {
    sendJson(response, 404, {code: 'E2E_NOT_FOUND', message: 'Unknown Notion endpoint'});
    return;
  }
  if (request.method !== expectedMethod) {
    sendJson(response, 405, {code: 'E2E_METHOD_NOT_ALLOWED', message: 'Method not allowed'});
    return;
  }

  if (path === NOTION_SEARCH_PATH) {
    return search({calls, pages, response, authorization, body: await readJsonBody(request)});
  }
  if (queryMatch) {
    return queryDataSource({
      calls,
      dataSources,
      response,
      authorization,
      dataSourceId: decodeURIComponent(queryMatch[1] ?? ''),
      body: await readJsonBody(request),
    });
  }
  if (path === NOTION_COMMENTS_PATH) {
    return getComments({
      calls,
      pages,
      response,
      authorization,
      blockId: requestUrl.searchParams.get('block_id') ?? '',
    });
  }

  if (markdownMatch) {
    const pageId = decodeURIComponent(markdownMatch[1] ?? '');
    calls.push({kind: 'get_page_content', authorization, pageId});
    sendJson(response, 200, {
      object: 'page_markdown',
      id: pageId,
      markdown: pages.get(pageId)?.markdown ?? '',
      truncated: false,
      unknown_block_ids: [],
    });
    return;
  }

  const pageId = decodeURIComponent(pageMatch?.[1] ?? '');
  calls.push({kind: 'get_page', authorization, pageId});
  const seeded = pages.get(pageId);
  if (seeded !== undefined) {
    sendJson(response, 200, pageBody(seeded));
    return;
  }
  sendJson(response, 200, {
    id: pageId,
    url: `https://www.notion.so/${pageId.replaceAll('-', '')}`,
    title: 'E2E Notion page',
    parent: {type: 'data_source_id', data_source_id: 'e2e-data-source'},
    properties: {
      Name: {
        id: 'title',
        type: 'title',
        title: [{plain_text: 'E2E Notion page'}],
      },
    },
    created_time: '2026-01-01T00:00:00.000Z',
    last_edited_time: '2026-01-02T00:00:00.000Z',
    marker: NOTION_PAGE_RESULT_MARKER,
  });
}

function pageBody(page: NotionPageFixture) {
  return {
    object: 'page',
    id: page.id,
    url: `https://www.notion.so/${page.id.replaceAll('-', '')}`,
    parent: {type: 'workspace', workspace: true},
    properties: {
      title: {
        id: 'title',
        type: 'title',
        title: [{type: 'text', text: {content: page.title}, plain_text: page.title}],
      },
    },
    created_time: '2026-01-01T00:00:00.000Z',
    last_edited_time: '2026-01-02T00:00:00.000Z',
    archived: false,
    in_trash: false,
  };
}

function search({
  calls,
  pages,
  response,
  authorization,
  body,
}: {
  calls: NotionApiMockCall[];
  pages: ReadonlyMap<string, NotionPageFixture>;
  response: ServerResponse;
  authorization: string | undefined;
  body: unknown;
}): void {
  const request = isJsonObject(body) ? body : {};
  calls.push({kind: 'search', authorization, body: request});
  const query = typeof request.query === 'string' ? request.query.toLowerCase() : '';
  const pageSize =
    typeof request.page_size === 'number' ? Math.min(request.page_size, NOTION_PAGE_SIZE) : 100;
  // Only pages are seeded, so a search for data sources finds none.
  const wantsDataSources = isJsonObject(request.filter) && request.filter.value === 'data_source';
  const matching = wantsDataSources
    ? []
    : [...pages.values()].filter((page) => page.title.toLowerCase().includes(query));
  sendJson(response, 200, {
    object: 'list',
    results: matching.slice(0, pageSize).map(pageBody),
    next_cursor: null,
    has_more: false,
    type: 'page_or_data_source',
  });
}

/** The cursor is the offset of the next row, which is all a client needs to hold. */
function queryDataSource({
  calls,
  dataSources,
  response,
  authorization,
  dataSourceId,
  body,
}: {
  calls: NotionApiMockCall[];
  dataSources: ReadonlyMap<string, NotionDataSourceFixture>;
  response: ServerResponse;
  authorization: string | undefined;
  dataSourceId: string;
  body: unknown;
}): void {
  const request = isJsonObject(body) ? body : {};
  const pageSize =
    typeof request.page_size === 'number'
      ? Math.min(request.page_size, NOTION_PAGE_SIZE)
      : NOTION_PAGE_SIZE;
  const startCursor = typeof request.start_cursor === 'string' ? request.start_cursor : undefined;
  calls.push({
    kind: 'query_data_source',
    authorization,
    dataSourceId,
    body: {
      ...(typeof request.page_size === 'number' ? {page_size: request.page_size} : {}),
      ...(startCursor === undefined ? {} : {start_cursor: startCursor}),
    },
  });
  const dataSource = dataSources.get(dataSourceId);
  if (dataSource === undefined) {
    sendJson(response, 404, {
      object: 'error',
      status: 404,
      code: 'object_not_found',
      message: `Could not find data source with ID: ${dataSourceId}.`,
    });
    return;
  }
  const offset = startCursor === undefined ? 0 : Number(startCursor);
  if (!Number.isInteger(offset) || offset < 0) {
    sendJson(response, 400, {
      object: 'error',
      status: 400,
      code: 'validation_error',
      message: 'start_cursor provided is invalid.',
    });
    return;
  }
  const end = offset + pageSize;
  sendJson(response, 200, {
    object: 'list',
    results: dataSource.rows.slice(offset, end).map(pageBody),
    next_cursor: end < dataSource.rows.length ? String(end) : null,
    has_more: end < dataSource.rows.length,
    type: 'page_or_data_source',
    page_or_data_source: {},
  });
}

function getComments({
  calls,
  pages,
  response,
  authorization,
  blockId,
}: {
  calls: NotionApiMockCall[];
  pages: ReadonlyMap<string, NotionPageFixture>;
  response: ServerResponse;
  authorization: string | undefined;
  blockId: string;
}): void {
  calls.push({kind: 'get_comments', authorization, blockId});
  const comments = (pages.get(blockId)?.comments ?? []).slice(0, NOTION_PAGE_SIZE);
  sendJson(response, 200, {
    object: 'list',
    results: comments.map((comment) => ({
      object: 'comment',
      id: comment.id,
      parent: {type: 'page_id', page_id: blockId},
      discussion_id: `discussion-${comment.id}`,
      created_time: '2026-01-01T00:00:00.000Z',
      last_edited_time: '2026-01-01T00:00:00.000Z',
      created_by: {object: 'user', id: 'e2e-notion-bot'},
      rich_text: [{type: 'text', text: {content: comment.text}, plain_text: comment.text}],
    })),
    next_cursor: null,
    has_more: false,
    type: 'comment',
  });
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody.length === 0 ? undefined : JSON.parse(rawBody);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredNotionApiBaseUrl(): string {
  const endpoint = process.env.NOTION_API_BASE_URL;
  if (!endpoint) throw new Error('NOTION_API_BASE_URL must be configured for the Notion API mock.');
  return endpoint;
}

function validateEndpoint(endpoint: URL): void {
  if (endpoint.port === '') {
    throw new Error(
      `NOTION_API_BASE_URL must include an explicit port for the Notion API mock (received ${endpoint}). Use :0 for an ephemeral test endpoint.`,
    );
  }
  if (endpoint.pathname !== '/') {
    throw new Error(
      `NOTION_API_BASE_URL must not include a path for the Notion API mock (received ${endpoint}).`,
    );
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}
