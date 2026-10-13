import {randomUUID} from 'node:crypto';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

const UUID_RE = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;

export const NOTION_PAGE_RESULT_MARKER = 'notion-page-result-marker';

const NOTION_PAGES_PATH = '/v1/pages';
const NOTION_PAGE_PATH_RE = /^\/v1\/pages\/([^/]+)$/;
const NOTION_PAGE_MARKDOWN_PATH_RE = /^\/v1\/pages\/([^/]+)\/markdown$/;
const NOTION_DATA_SOURCE_QUERY_PATH_RE = /^\/v1\/data_sources\/([^/]+)\/query$/;
const NOTION_SEARCH_PATH = '/v1/search';
const NOTION_COMMENTS_PATH = '/v1/comments';
const NOTION_PAGE_SIZE = 100;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;

/** Where a page lives. A page without a parent is at the top of the workspace. */
export type NotionPageParent =
  | {type: 'page_id'; page_id: string}
  | {type: 'data_source_id'; data_source_id: string};

/** A comment on a page the fake serves. */
export interface NotionCommentFixture {
  id: string;
  text: string;
  /** The discussion the comment belongs to. A comment without one starts its own. */
  discussionId?: string | undefined;
}

/** A page the fake serves, in the shape the tools read. */
export interface NotionPageFixture {
  id: string;
  title: string;
  parent?: NotionPageParent | undefined;
  /** What `get_page_content` returns. */
  markdown?: string | undefined;
  /** Oldest first. */
  comments?: readonly NotionCommentFixture[] | undefined;
}

/** A data source the fake serves. A query returns its rows as pages, in order. */
export interface NotionDataSourceFixture {
  id: string;
  rows: readonly NotionPageFixture[];
}

export type NotionApiMockCall =
  | {kind: 'create_page'; authorization: string | undefined; body: Record<string, unknown>}
  | {
      kind: 'update_page';
      authorization: string | undefined;
      pageId: string;
      body: Record<string, unknown>;
    }
  | {
      kind: 'update_page_content';
      authorization: string | undefined;
      pageId: string;
      body: Record<string, unknown>;
    }
  | {kind: 'add_comment'; authorization: string | undefined; body: Record<string, unknown>}
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
  /**
   * The pages created, the page updates, and the comments the fake accepted, in arrival order.
   * Each change shows in the next read of the page.
   */
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
  /**
   * Answers a page read as Notion does: 400 for an id that is not a UUID, and 404 for a page no
   * seed names, instead of a placeholder page.
   */
  rejectUnseeded?: boolean | undefined;
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
      rejectUnseeded: options.rejectUnseeded === true,
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
    writes: () => notionWrites(calls),
    stop: async () => {
      try {
        await listening.close();
      } catch (error) {
        throw new Error(`Notion API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

function notionWrites(calls: readonly NotionApiMockCall[]): RecordedWrite[] {
  return calls.flatMap((call): RecordedWrite[] => {
    switch (call.kind) {
      case 'create_page':
        return [{kind: call.kind, target: parentTarget(call.body.parent), payload: {...call.body}}];
      case 'update_page':
      case 'update_page_content':
        return [{kind: call.kind, target: call.pageId, payload: {...call.body}}];
      case 'add_comment':
        return [{kind: call.kind, target: parentTarget(call.body.parent), payload: {...call.body}}];
      default:
        return [];
    }
  });
}

/** The page or discussion a create or a comment names, or an empty string when it names none. */
function parentTarget(parent: unknown): string {
  if (!isJsonObject(parent)) return '';
  const target = parent.page_id ?? parent.data_source_id ?? parent.discussion_id;
  return typeof target === 'string' ? target : '';
}

/** The methods the fake serves at `path`, or none for a path it does not serve. */
function notionMethods(path: string): readonly string[] {
  if (path === NOTION_SEARCH_PATH || path === NOTION_PAGES_PATH) return ['POST'];
  if (NOTION_DATA_SOURCE_QUERY_PATH_RE.test(path)) return ['POST'];
  if (NOTION_PAGE_PATH_RE.test(path) || NOTION_PAGE_MARKDOWN_PATH_RE.test(path))
    return ['GET', 'PATCH'];
  return path === NOTION_COMMENTS_PATH ? ['GET', 'POST'] : [];
}

async function handleNotionRequest(params: {
  calls: NotionApiMockCall[];
  pages: Map<string, NotionPageFixture>;
  dataSources: ReadonlyMap<string, NotionDataSourceFixture>;
  rejectUnseeded: boolean;
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const {calls, pages, dataSources, request, response} = params;
  const requestUrl = new URL(request.url ?? '/', params.endpoint);
  const authorization = request.headers.authorization;
  const path = requestUrl.pathname;

  const queryMatch = path.match(NOTION_DATA_SOURCE_QUERY_PATH_RE);
  const methods = notionMethods(path);
  if (methods.length === 0) {
    sendJson(response, 404, {code: 'E2E_NOT_FOUND', message: 'Unknown Notion endpoint'});
    return;
  }
  if (!methods.includes(request.method ?? '')) {
    sendJson(response, 405, {code: 'E2E_METHOD_NOT_ALLOWED', message: 'Method not allowed'});
    return;
  }

  if (path === NOTION_PAGES_PATH) {
    return createPage({calls, pages, response, authorization, body: await readJsonBody(request)});
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
  if (path === NOTION_COMMENTS_PATH && request.method === 'POST') {
    return addComment({calls, pages, response, authorization, body: await readJsonBody(request)});
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

  return await handlePageRequest({...params, authorization, path});
}

async function handlePageRequest({
  calls,
  pages,
  rejectUnseeded,
  request,
  response,
  authorization,
  path,
}: {
  calls: NotionApiMockCall[];
  pages: Map<string, NotionPageFixture>;
  rejectUnseeded: boolean;
  request: IncomingMessage;
  response: ServerResponse;
  authorization: string | undefined;
  path: string;
}): Promise<void> {
  const markdownMatch = path.match(NOTION_PAGE_MARKDOWN_PATH_RE);
  if (markdownMatch) {
    const pageId = decodeURIComponent(markdownMatch[1] ?? '');
    if (request.method === 'PATCH') {
      return updatePageContent({
        calls,
        pages,
        response,
        authorization,
        pageId,
        body: await readJsonBody(request),
      });
    }
    calls.push({kind: 'get_page_content', authorization, pageId});
    sendJson(response, 200, markdownBody(pageId, pages.get(pageId)?.markdown ?? ''));
    return;
  }

  const pageId = decodeURIComponent(path.match(NOTION_PAGE_PATH_RE)?.[1] ?? '');
  if (request.method === 'PATCH') {
    return updatePage({
      calls,
      pages,
      response,
      authorization,
      pageId,
      body: await readJsonBody(request),
    });
  }
  calls.push({kind: 'get_page', authorization, pageId});
  const seeded = pages.get(pageId);
  if (seeded !== undefined) {
    sendJson(response, 200, pageBody(seeded));
    return;
  }
  if (rejectUnseeded) {
    if (UUID_RE.test(pageId)) sendPageNotFound(response, pageId);
    else {
      sendNotionError(
        response,
        400,
        'validation_error',
        `path failed validation: path.page_id should be a valid uuid, instead was \`"${pageId}"\`.`,
      );
    }
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

function markdownBody(pageId: string, markdown: string) {
  return {
    object: 'page_markdown',
    id: pageId,
    markdown,
    truncated: false,
    unknown_block_ids: [],
  };
}

function pageBody(page: NotionPageFixture) {
  return {
    object: 'page',
    id: page.id,
    url: `https://www.notion.so/${page.id.replaceAll('-', '')}`,
    parent: page.parent ?? {type: 'workspace', workspace: true},
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

function createPage({
  calls,
  pages,
  response,
  authorization,
  body,
}: {
  calls: NotionApiMockCall[];
  pages: Map<string, NotionPageFixture>;
  response: ServerResponse;
  authorization: string | undefined;
  body: unknown;
}): void {
  const request = isJsonObject(body) ? body : {};
  calls.push({kind: 'create_page', authorization, body: request});
  const page: NotionPageFixture = {
    id: randomUUID(),
    title: titleOf(request.properties) ?? '',
    parent: parentOf(request.parent),
    markdown: typeof request.markdown === 'string' ? request.markdown : '',
  };
  pages.set(page.id, page);
  sendJson(response, 200, pageBody(page));
}

function updatePage({
  calls,
  pages,
  response,
  authorization,
  pageId,
  body,
}: {
  calls: NotionApiMockCall[];
  pages: Map<string, NotionPageFixture>;
  response: ServerResponse;
  authorization: string | undefined;
  pageId: string;
  body: unknown;
}): void {
  const request = isJsonObject(body) ? body : {};
  const page = pages.get(pageId);
  if (page === undefined) {
    sendPageNotFound(response, pageId);
    return;
  }
  calls.push({kind: 'update_page', authorization, pageId, body: request});
  const updated = {...page, title: titleOf(request.properties) ?? page.title};
  pages.set(pageId, updated);
  sendJson(response, 200, pageBody(updated));
}

function updatePageContent({
  calls,
  pages,
  response,
  authorization,
  pageId,
  body,
}: {
  calls: NotionApiMockCall[];
  pages: Map<string, NotionPageFixture>;
  response: ServerResponse;
  authorization: string | undefined;
  pageId: string;
  body: unknown;
}): void {
  const request = isJsonObject(body) ? body : {};
  const page = pages.get(pageId);
  if (page === undefined) {
    sendPageNotFound(response, pageId);
    return;
  }
  const markdown = updatedMarkdown(page.markdown ?? '', request);
  if (markdown === undefined) {
    sendNotionError(response, 400, 'validation_error', 'The markdown update is invalid.');
    return;
  }
  calls.push({kind: 'update_page_content', authorization, pageId, body: request});
  pages.set(pageId, {...page, markdown});
  sendJson(response, 200, markdownBody(pageId, markdown));
}

/** Replaces the content, or adds to its end. The fake does not take any other insert position. */
function updatedMarkdown(markdown: string, request: Record<string, unknown>): string | undefined {
  if (request.type === 'replace_content' && isJsonObject(request.replace_content)) {
    const {new_str: replacement} = request.replace_content;
    return typeof replacement === 'string' ? replacement : undefined;
  }
  if (request.type === 'insert_content' && isJsonObject(request.insert_content)) {
    const {content} = request.insert_content;
    if (typeof content !== 'string') return undefined;
    return markdown.length === 0 ? content : `${markdown}\n${content}`;
  }
  return undefined;
}

function addComment({
  calls,
  pages,
  response,
  authorization,
  body,
}: {
  calls: NotionApiMockCall[];
  pages: Map<string, NotionPageFixture>;
  response: ServerResponse;
  authorization: string | undefined;
  body: unknown;
}): void {
  const request = isJsonObject(body) ? body : {};
  const parent = isJsonObject(request.parent) ? request.parent : {};
  const discussionId = typeof parent.discussion_id === 'string' ? parent.discussion_id : undefined;
  const page =
    discussionId === undefined
      ? pages.get(String(parent.page_id ?? ''))
      : [...pages.values()].find((candidate) =>
          candidate.comments?.some((comment) => commentDiscussionId(comment) === discussionId),
        );
  if (page === undefined) {
    sendPageNotFound(response, String(parent.page_id ?? discussionId ?? ''));
    return;
  }
  calls.push({kind: 'add_comment', authorization, body: request});
  const comment: NotionCommentFixture = {
    id: randomUUID(),
    text: Array.isArray(request.rich_text)
      ? request.rich_text.filter(isJsonObject).map(richTextContent).join('')
      : '',
    discussionId,
  };
  pages.set(page.id, {...page, comments: [...(page.comments ?? []), comment]});
  sendJson(response, 200, commentBody(page.id, comment));
}

function commentDiscussionId(comment: NotionCommentFixture): string {
  return comment.discussionId ?? `discussion-${comment.id}`;
}

function commentBody(pageId: string, comment: NotionCommentFixture) {
  return {
    object: 'comment',
    id: comment.id,
    parent: {type: 'page_id', page_id: pageId},
    discussion_id: commentDiscussionId(comment),
    created_time: '2026-01-01T00:00:00.000Z',
    last_edited_time: '2026-01-01T00:00:00.000Z',
    created_by: {object: 'user', id: 'e2e-notion-bot'},
    rich_text: [{type: 'text', text: {content: comment.text}, plain_text: comment.text}],
  };
}

function parentOf(parent: unknown): NotionPageParent | undefined {
  if (!isJsonObject(parent)) return undefined;
  if (typeof parent.page_id === 'string') return {type: 'page_id', page_id: parent.page_id};
  if (typeof parent.data_source_id === 'string')
    return {type: 'data_source_id', data_source_id: parent.data_source_id};
  return undefined;
}

/** The title in the properties of a write, whatever the title property is called. */
function titleOf(properties: unknown): string | undefined {
  if (!isJsonObject(properties)) return undefined;
  for (const property of Object.values(properties)) {
    if (isJsonObject(property) && Array.isArray(property.title)) {
      return property.title.filter(isJsonObject).map(richTextContent).join('');
    }
  }
  return undefined;
}

function richTextContent(item: Record<string, unknown>): string {
  if (typeof item.plain_text === 'string') return item.plain_text;
  return isJsonObject(item.text) && typeof item.text.content === 'string' ? item.text.content : '';
}

function sendPageNotFound(response: ServerResponse, pageId: string): void {
  sendNotionError(
    response,
    404,
    'object_not_found',
    `Could not find page with ID: ${pageId}. Make sure the relevant pages and databases are shared with your integration.`,
  );
}

function sendNotionError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  sendJson(response, status, {object: 'error', status, code, message});
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
    sendNotionError(
      response,
      404,
      'object_not_found',
      `Could not find data source with ID: ${dataSourceId}.`,
    );
    return;
  }
  const offset = startCursor === undefined ? 0 : Number(startCursor);
  if (!Number.isInteger(offset) || offset < 0) {
    sendNotionError(response, 400, 'validation_error', 'start_cursor provided is invalid.');
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
    results: comments.map((comment) => commentBody(blockId, comment)),
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
