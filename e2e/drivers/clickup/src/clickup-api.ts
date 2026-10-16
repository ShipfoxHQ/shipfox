import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

export const CLICKUP_TASK_RESULT_MARKER = 'clickup-task-result-marker';
export const CLICKUP_COMMENT_RESULT_MARKER = 'clickup-comment-result-marker';

const CLICKUP_TASK_PATH_RE = /^\/api\/v2\/task\/([^/]+)(?:\/(comment)|\/(tag|field)\/([^/]+))?$/;
const CLICKUP_TEAM_TASKS_PATH_RE = /^\/api\/v2\/team\/[^/]+\/task$/;
const CLICKUP_LIST_TASKS_PATH_RE = /^\/api\/v2\/list\/([^/]+)\/task$/;
// ClickUp answers a team task search with 100 tasks per page, and a comment list with 25.
const CLICKUP_TASKS_PAGE_SIZE = 100;
const CLICKUP_COMMENTS_PAGE_SIZE = 25;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;
// The statuses that close a task. A task takes any other status as open.
const CLICKUP_CLOSED_STATUSES = new Set(['complete', 'closed']);

/** A comment on a task the fake serves. */
export interface ClickUpCommentFixture {
  id: string;
  text: string;
}

/** A custom field value on a task the fake serves. */
export interface ClickUpCustomFieldFixture {
  id: string;
  value: unknown;
}

/** A task the fake serves, in the shape the tools read. */
export interface ClickUpTaskFixture {
  id: string;
  name: string;
  url: string;
  markdownDescription: string;
  /** The List the task belongs to. A task search filters on it. */
  list?: {id: string; name: string} | undefined;
  /** A closed task is left out of a task search unless it asks for closed tasks. */
  closed?: boolean | undefined;
  /** The name of the status. A task without one is `complete` when closed and `to do` otherwise. */
  status?: string | undefined;
  /** The ID of the parent task. A subtask is left out of a task search unless it asks for them. */
  parentId?: string | undefined;
  /** Newest first, like the real API. */
  comments?: readonly ClickUpCommentFixture[] | undefined;
  /** Tag names, in the order they were added. */
  tags?: readonly string[] | undefined;
  customFields?: readonly ClickUpCustomFieldFixture[] | undefined;
}

export interface StartClickUpApiMockOptions {
  /**
   * The access token the API presents, from the connection the spec creates. The fake shares the
   * stack's ClickUp address with other specs and answers the requests that carry this token.
   */
  accessToken?: string | undefined;
  /** Listens here directly instead of behind the stack's router. Unit tests pass port 0. */
  endpoint?: URL | undefined;
  /** Tasks the fake serves by ID. Any other task gets a placeholder. */
  tasks?: readonly ClickUpTaskFixture[];
  /**
   * Answers a task no seed names the way ClickUp answers one that does not exist (401, as ClickUp
   * does for a task the token cannot see), instead of with a placeholder.
   */
  rejectUnseeded?: boolean | undefined;
}

export type ClickUpApiMockCall =
  | {
      kind: 'create_task';
      authorization: string | undefined;
      listId: string;
      query: Record<string, string>;
      body: Record<string, unknown>;
    }
  | {
      kind: 'get_task';
      authorization: string | undefined;
      taskId: string;
      query: Record<string, string>;
    }
  | {
      kind: 'get_task_comments';
      authorization: string | undefined;
      taskId: string;
      query: Record<string, string>;
    }
  | {
      kind: 'search_tasks';
      authorization: string | undefined;
      query: Record<string, string | string[]>;
    }
  | {
      kind: 'add_comment';
      authorization: string | undefined;
      taskId: string;
      query: Record<string, string>;
      body: {comment_text?: string; notify_all?: boolean};
    }
  | {
      kind: 'update_task';
      authorization: string | undefined;
      taskId: string;
      query: Record<string, string>;
      body: Record<string, unknown>;
    }
  | {
      kind: 'add_tag' | 'remove_tag';
      authorization: string | undefined;
      taskId: string;
      tagName: string;
      query: Record<string, string>;
    }
  | {
      kind: 'set_custom_field';
      authorization: string | undefined;
      taskId: string;
      fieldId: string;
      query: Record<string, string>;
      body: Record<string, unknown>;
    };

export interface ClickUpApiMock {
  calls: ClickUpApiMockCall[];
  /** The tasks the fake serves, by ID. Add to it to seed the fake after it started. */
  tasks: Map<string, ClickUpTaskFixture>;
  endpoint: URL;
  /**
   * The tasks created, the task updates, the comments, the tag changes, and the custom field values
   * the fake accepted, in arrival order. Each change shows in the next read of the task.
   */
  writes(): RecordedWrite[];
  stop(): Promise<void>;
}

export async function startClickUpApiMock(
  options: StartClickUpApiMockOptions = {},
): Promise<ClickUpApiMock> {
  const configuredEndpoint = options.endpoint ?? new URL(requiredClickUpApiBaseUrl());
  validateEndpoint(configuredEndpoint);
  const calls: ClickUpApiMockCall[] = [];
  const tasks = new Map((options.tasks ?? []).map((task) => [task.id, task]));
  let boundEndpoint = configuredEndpoint;
  let createdCount = 0;
  const nextId = (prefix: string) => `${prefix}-${++createdCount}`;
  const server = createServer((request, response) => {
    void handleClickUpRequest({
      calls,
      tasks,
      nextId,
      rejectUnseeded: options.rejectUnseeded === true,
      endpoint: boundEndpoint,
      request,
      response,
    }).catch((error) => {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      process.stderr.write(
        `ClickUp API mock request failed: ${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}\n`,
      );
      if (response.destroyed || response.writableEnded) return;
      if (!response.headersSent)
        sendJson(response, 400, {err: 'Invalid ClickUp request', ECODE: 'E2E_BAD_REQUEST'});
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
    throw new Error(`ClickUp API mock failed to start at ${configuredEndpoint}`, {cause: error});
  }
  boundEndpoint = listening.endpoint;

  return {
    calls,
    tasks,
    endpoint: boundEndpoint,
    writes: () => clickUpWrites(calls),
    stop: async () => {
      try {
        await listening.close();
      } catch (error) {
        throw new Error(`ClickUp API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

function clickUpWrites(calls: readonly ClickUpApiMockCall[]): RecordedWrite[] {
  return calls.flatMap((call): RecordedWrite[] => {
    if (call.kind === 'create_task')
      return [{kind: call.kind, target: call.listId, payload: {...call.body}}];
    if (call.kind === 'add_comment' || call.kind === 'update_task')
      return [{kind: call.kind, target: call.taskId, payload: {...call.body}}];
    if (call.kind === 'add_tag' || call.kind === 'remove_tag')
      return [{kind: call.kind, target: call.taskId, payload: {tag_name: call.tagName}}];
    if (call.kind === 'set_custom_field')
      return [
        {kind: call.kind, target: call.taskId, payload: {field_id: call.fieldId, ...call.body}},
      ];
    return [];
  });
}

interface ClickUpTaskRequest {
  calls: ClickUpApiMockCall[];
  tasks: Map<string, ClickUpTaskFixture>;
  nextId: (prefix: string) => string;
  rejectUnseeded: boolean;
  request: IncomingMessage;
  response: ServerResponse;
  taskId: string;
  /** The tag name or the custom field ID after `/tag/` or `/field/`. */
  itemId: string;
  query: Record<string, string>;
  authorization: string | undefined;
}

async function handleClickUpRequest(params: {
  calls: ClickUpApiMockCall[];
  tasks: Map<string, ClickUpTaskFixture>;
  nextId: (prefix: string) => string;
  rejectUnseeded: boolean;
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  if (await handleCollectionRequest({...params, requestUrl})) return;
  const match = requestUrl.pathname.match(CLICKUP_TASK_PATH_RE);
  if (!match) {
    sendJson(params.response, 404, {err: 'Unknown ClickUp endpoint', ECODE: 'E2E_NOT_FOUND'});
    return;
  }

  const task: ClickUpTaskRequest = {
    calls: params.calls,
    tasks: params.tasks,
    nextId: params.nextId,
    rejectUnseeded: params.rejectUnseeded,
    request: params.request,
    response: params.response,
    taskId: decodeURIComponent(match[1] ?? ''),
    itemId: decodeURIComponent(match[4] ?? ''),
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    authorization: params.request.headers.authorization,
  };
  const route = `${params.request.method} ${match[2] ?? match[3] ?? 'task'}`;

  if (route === 'GET task') return getTask(task);
  if (route === 'PUT task') return await updateTask(task);
  if (route === 'GET comment') return getTaskComments(task);
  if (route === 'POST comment') return await addComment(task);
  if (route === 'POST tag' || route === 'DELETE tag') return changeTag(task);
  if (route === 'POST field') return await setCustomField(task);
  sendJson(params.response, 405, {err: 'Method not allowed', ECODE: 'E2E_METHOD_NOT_ALLOWED'});
}

/** Serves the task search of a team and the task creation in a List. False for any other path. */
async function handleCollectionRequest(
  params: Omit<ClickUpTaskRequest, 'taskId' | 'itemId' | 'query' | 'authorization'> & {
    requestUrl: URL;
  },
): Promise<boolean> {
  const {requestUrl, request, response} = params;
  const isSearch = CLICKUP_TEAM_TASKS_PATH_RE.test(requestUrl.pathname);
  const listMatch = requestUrl.pathname.match(CLICKUP_LIST_TASKS_PATH_RE);
  if (!isSearch && !listMatch) return false;
  if (request.method !== (isSearch ? 'GET' : 'POST')) {
    sendJson(response, 405, {err: 'Method not allowed', ECODE: 'E2E_METHOD_NOT_ALLOWED'});
    return true;
  }
  const authorization = request.headers.authorization;
  if (isSearch) {
    searchTasks({
      calls: params.calls,
      tasks: params.tasks,
      response,
      searchParams: requestUrl.searchParams,
      authorization,
    });
    return true;
  }
  await createTask({
    calls: params.calls,
    tasks: params.tasks,
    nextId: params.nextId,
    rejectUnseeded: params.rejectUnseeded,
    request,
    response,
    listId: decodeURIComponent(listMatch?.[1] ?? ''),
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    authorization,
  });
  return true;
}

function getTask({
  calls,
  tasks,
  rejectUnseeded,
  response,
  taskId,
  query,
  authorization,
}: ClickUpTaskRequest): void {
  calls.push({kind: 'get_task', authorization, taskId, query});
  const task = tasks.get(taskId);
  if (task === undefined && rejectUnseeded) {
    sendJson(response, 401, {err: 'Task not found, deleted, or access denied.', ECODE: 'ITEM_015'});
    return;
  }
  sendJson(
    response,
    200,
    task === undefined
      ? {id: taskId, name: 'E2E ClickUp task', description: CLICKUP_TASK_RESULT_MARKER}
      : taskBody(task),
  );
}

function taskBody(task: ClickUpTaskFixture) {
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    markdown_description: task.markdownDescription,
    status: statusBody(task),
    tags: (task.tags ?? []).map((name) => ({name, tag_fg: '#e16b16', tag_bg: '#e16b16'})),
    // ClickUp leaves `value` out of a field that has none.
    custom_fields: (task.customFields ?? []).map((field) => ({
      id: field.id,
      ...(field.value === undefined ? {} : {value: field.value}),
    })),
    ...(task.list === undefined ? {} : {list: listBody(task.list)}),
  };
}

function statusBody(task: ClickUpTaskFixture): {status: string; type: 'open' | 'closed'} {
  const closed = task.closed === true;
  return {status: task.status ?? (closed ? 'complete' : 'to do'), type: closed ? 'closed' : 'open'};
}

function getTaskComments({
  calls,
  tasks,
  response,
  taskId,
  query,
  authorization,
}: ClickUpTaskRequest): void {
  calls.push({kind: 'get_task_comments', authorization, taskId, query});
  const comments = tasks.get(taskId)?.comments ?? [];
  sendJson(response, 200, {
    comments: comments.slice(0, CLICKUP_COMMENTS_PAGE_SIZE).map((comment) => ({
      id: comment.id,
      comment: [{text: comment.text}],
      comment_text: comment.text,
      user: {id: 1, username: 'Contracts'},
      resolved: false,
      assignee: null,
      assigned_by: null,
      reactions: [],
      date: '1790000000000',
    })),
  });
}

function searchTasks({
  calls,
  tasks,
  response,
  searchParams,
  authorization,
}: {
  calls: ClickUpApiMockCall[];
  tasks: ReadonlyMap<string, ClickUpTaskFixture>;
  response: ServerResponse;
  searchParams: URLSearchParams;
  authorization: string | undefined;
}): void {
  calls.push({kind: 'search_tasks', authorization, query: queryOf(searchParams)});
  const listIds = searchParams.getAll('list_ids[]');
  const includeClosed = searchParams.get('include_closed') === 'true';
  const includeSubtasks = searchParams.get('subtasks') === 'true';
  const page = Number(searchParams.get('page') ?? 0);
  // ClickUp fails on a page it cannot count from, instead of rejecting the request.
  if (!Number.isInteger(page) || page < 0) {
    sendJson(response, 500, {err: 'Internal server error'});
    return;
  }
  const matching = [...tasks.values()].filter(
    (task) =>
      task.list !== undefined &&
      (listIds.length === 0 || listIds.includes(task.list.id)) &&
      (includeClosed || task.closed !== true) &&
      (includeSubtasks || task.parentId === undefined),
  );
  const start = page * CLICKUP_TASKS_PAGE_SIZE;
  sendJson(response, 200, {
    tasks: matching.slice(start, start + CLICKUP_TASKS_PAGE_SIZE).map((task) => ({
      id: task.id,
      name: task.name,
      url: task.url,
      text_content: task.markdownDescription,
      status: statusBody(task),
      parent: task.parentId ?? null,
      list: task.list === undefined ? undefined : listBody(task.list),
    })),
    last_page: start + CLICKUP_TASKS_PAGE_SIZE >= matching.length,
  });
}

function listBody(list: {id: string; name: string}): {id: string; name: string; access: boolean} {
  return {id: list.id, name: list.name, access: true};
}

function queryOf(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    query[key] = key.endsWith('[]') ? values : (values[0] ?? '');
  }
  return query;
}

async function createTask({
  calls,
  tasks,
  nextId,
  request,
  response,
  listId,
  query,
  authorization,
}: Omit<ClickUpTaskRequest, 'taskId' | 'itemId'> & {listId: string}): Promise<void> {
  const parsed = await readJsonBody(request);
  const body = isJsonObject(parsed) ? parsed : {};
  calls.push({kind: 'create_task', authorization, listId, query, body});
  const id = nextId('e2e-clickup-task');
  const task = applyTaskUpdate(
    {
      id,
      name: '',
      url: `https://app.clickup.com/t/${id}`,
      markdownDescription: '',
      list: {id: listId, name: listId},
      parentId: typeof body.parent === 'string' ? body.parent : undefined,
    },
    body,
  );
  tasks.set(id, task);
  sendJson(response, 200, taskBody(task));
}

/** Takes the fields a task create or update sets, and leaves the rest of the task as it was. */
function applyTaskUpdate(
  task: ClickUpTaskFixture,
  body: Record<string, unknown>,
): ClickUpTaskFixture {
  const status = typeof body.status === 'string' ? body.status : undefined;
  return {
    ...task,
    ...(typeof body.name === 'string' ? {name: body.name} : {}),
    ...(typeof body.markdown_content === 'string'
      ? {markdownDescription: body.markdown_content}
      : {}),
    ...(status === undefined
      ? {}
      : {status, closed: CLICKUP_CLOSED_STATUSES.has(status.toLowerCase())}),
  };
}

async function updateTask({
  calls,
  tasks,
  request,
  response,
  taskId,
  query,
  authorization,
}: ClickUpTaskRequest): Promise<void> {
  const body = await readJsonBody(request);
  const update = isJsonObject(body) ? body : {};
  calls.push({kind: 'update_task', authorization, taskId, query, body: update});
  const task = tasks.get(taskId);
  if (task === undefined) {
    sendJson(response, 200, {id: taskId, name: 'E2E ClickUp task'});
    return;
  }
  const updated = applyTaskUpdate(task, update);
  tasks.set(taskId, updated);
  sendJson(response, 200, taskBody(updated));
}

async function addComment({
  calls,
  tasks,
  nextId,
  request,
  response,
  taskId,
  query,
  authorization,
}: ClickUpTaskRequest): Promise<void> {
  const body = await readJsonBody(request);
  const comment = isCommentBody(body) ? body : {};
  calls.push({kind: 'add_comment', authorization, taskId, query, body: comment});
  const id = nextId('e2e-clickup-comment');
  const task = tasks.get(taskId);
  if (task !== undefined && typeof comment.comment_text === 'string') {
    // Newest first, like the real API.
    tasks.set(taskId, {
      ...task,
      comments: [{id, text: comment.comment_text}, ...(task.comments ?? [])],
    });
  }
  sendJson(response, 200, {
    id,
    hist_id: 'e2e-clickup-history',
    date: String(Date.now()),
    marker: CLICKUP_COMMENT_RESULT_MARKER,
  });
}

/**
 * Adds or removes a tag. ClickUp stores tag names in lowercase, creates a tag the Space lacks, and
 * answers both with an empty object.
 */
function changeTag({
  calls,
  tasks,
  request,
  response,
  taskId,
  itemId,
  query,
  authorization,
}: ClickUpTaskRequest): void {
  const kind = request.method === 'DELETE' ? 'remove_tag' : 'add_tag';
  calls.push({kind, authorization, taskId, tagName: itemId, query});
  const tagName = itemId.toLowerCase();
  const task = tasks.get(taskId);
  if (task !== undefined) {
    const others = (task.tags ?? []).filter((name) => name !== tagName);
    tasks.set(taskId, {...task, tags: kind === 'add_tag' ? [...others, tagName] : others});
  }
  sendJson(response, 200, {});
}

/** Sets the value of a custom field. ClickUp answers with an empty object. */
async function setCustomField({
  calls,
  tasks,
  request,
  response,
  taskId,
  itemId,
  query,
  authorization,
}: ClickUpTaskRequest): Promise<void> {
  const parsed = await readJsonBody(request);
  const body = isJsonObject(parsed) ? parsed : {};
  calls.push({kind: 'set_custom_field', authorization, taskId, fieldId: itemId, query, body});
  const task = tasks.get(taskId);
  if (task !== undefined) {
    const others = (task.customFields ?? []).filter((field) => field.id !== itemId);
    tasks.set(taskId, {...task, customFields: [...others, {id: itemId, value: body.value}]});
  }
  sendJson(response, 200, {});
}

function requiredClickUpApiBaseUrl(): string {
  const endpoint = process.env.CLICKUP_API_BASE_URL;
  if (!endpoint)
    throw new Error('CLICKUP_API_BASE_URL must be configured for the ClickUp API mock.');
  return endpoint;
}

function validateEndpoint(endpoint: URL): void {
  if (endpoint.port === '') {
    throw new Error(
      `CLICKUP_API_BASE_URL must include an explicit port for the ClickUp API mock (received ${endpoint}). Use :0 for an ephemeral test endpoint.`,
    );
  }
  if (endpoint.pathname !== '/') {
    throw new Error(
      `CLICKUP_API_BASE_URL must not include a path for the ClickUp API mock (received ${endpoint}).`,
    );
  }
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody.length === 0 ? undefined : JSON.parse(rawBody);
}

function isCommentBody(value: unknown): value is {comment_text?: string; notify_all?: boolean} {
  return isJsonObject(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}
