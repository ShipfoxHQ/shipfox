import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

export const CLICKUP_TASK_RESULT_MARKER = 'clickup-task-result-marker';
export const CLICKUP_COMMENT_RESULT_MARKER = 'clickup-comment-result-marker';

const CLICKUP_TASK_PATH_RE = /^\/api\/v2\/task\/([^/]+)(?:\/comment)?$/;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;

/** A task the fake serves, in the shape the tools read. */
export interface ClickUpTaskFixture {
  id: string;
  name: string;
  url: string;
  markdownDescription: string;
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
}

export type ClickUpApiMockCall =
  | {
      kind: 'get_task';
      authorization: string | undefined;
      taskId: string;
      query: Record<string, string>;
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
    };

export interface ClickUpApiMock {
  calls: ClickUpApiMockCall[];
  endpoint: URL;
  /** Writes the fake accepted, in arrival order. */
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
  const server = createServer((request, response) => {
    void handleClickUpRequest({calls, tasks, endpoint: boundEndpoint, request, response}).catch(
      (error) => {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        process.stderr.write(
          `ClickUp API mock request failed: ${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}\n`,
        );
        if (response.destroyed || response.writableEnded) return;
        if (!response.headersSent)
          sendJson(response, 400, {err: 'Invalid ClickUp request', ECODE: 'E2E_BAD_REQUEST'});
        else response.end();
      },
    );
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
  return calls.flatMap((call) =>
    call.kind === 'get_task'
      ? []
      : [{kind: call.kind, target: call.taskId, payload: {...call.body}}],
  );
}

interface ClickUpTaskRequest {
  calls: ClickUpApiMockCall[];
  tasks: ReadonlyMap<string, ClickUpTaskFixture>;
  request: IncomingMessage;
  response: ServerResponse;
  taskId: string;
  query: Record<string, string>;
  authorization: string | undefined;
}

async function handleClickUpRequest(params: {
  calls: ClickUpApiMockCall[];
  tasks: ReadonlyMap<string, ClickUpTaskFixture>;
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  const match = requestUrl.pathname.match(CLICKUP_TASK_PATH_RE);
  if (!match) {
    sendJson(params.response, 404, {err: 'Unknown ClickUp endpoint', ECODE: 'E2E_NOT_FOUND'});
    return;
  }

  const task: ClickUpTaskRequest = {
    calls: params.calls,
    tasks: params.tasks,
    request: params.request,
    response: params.response,
    taskId: decodeURIComponent(match[1] ?? ''),
    query: Object.fromEntries(requestUrl.searchParams.entries()),
    authorization: params.request.headers.authorization,
  };
  const isComment = requestUrl.pathname.endsWith('/comment');

  if (params.request.method === 'GET' && !isComment) return getTask(task);
  if (params.request.method === 'PUT' && !isComment) return await updateTask(task);
  if (params.request.method === 'POST' && isComment) return await addComment(task);
  sendJson(params.response, 405, {err: 'Method not allowed', ECODE: 'E2E_METHOD_NOT_ALLOWED'});
}

function getTask({calls, tasks, response, taskId, query, authorization}: ClickUpTaskRequest): void {
  calls.push({kind: 'get_task', authorization, taskId, query});
  const task = tasks.get(taskId);
  sendJson(
    response,
    200,
    task === undefined
      ? {id: taskId, name: 'E2E ClickUp task', description: CLICKUP_TASK_RESULT_MARKER}
      : {
          id: task.id,
          name: task.name,
          url: task.url,
          markdown_description: task.markdownDescription,
        },
  );
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
  calls.push({
    kind: 'update_task',
    authorization,
    taskId,
    query,
    body: isJsonObject(body) ? body : {},
  });
  sendJson(response, 200, {id: taskId, name: tasks.get(taskId)?.name ?? 'E2E ClickUp task'});
}

async function addComment({
  calls,
  request,
  response,
  taskId,
  query,
  authorization,
}: ClickUpTaskRequest): Promise<void> {
  const body = await readJsonBody(request);
  calls.push({
    kind: 'add_comment',
    authorization,
    taskId,
    query,
    body: isCommentBody(body) ? body : {},
  });
  sendJson(response, 200, {
    id: 'e2e-clickup-comment',
    hist_id: 'e2e-clickup-history',
    date: String(Date.now()),
    marker: CLICKUP_COMMENT_RESULT_MARKER,
  });
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
