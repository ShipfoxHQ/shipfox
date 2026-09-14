import {once} from 'node:events';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

export const CLICKUP_TASK_RESULT_MARKER = 'clickup-task-result-marker';
export const CLICKUP_COMMENT_RESULT_MARKER = 'clickup-comment-result-marker';

const CLICKUP_TASK_PATH_RE = /^\/api\/v2\/task\/([^/]+)(?:\/comment)?$/;

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
    };

export interface ClickUpApiMock {
  calls: ClickUpApiMockCall[];
  endpoint: URL;
  stop(): Promise<void>;
}

export async function startClickUpApiMock(
  endpoint = new URL(requiredClickUpApiBaseUrl()),
): Promise<ClickUpApiMock> {
  validateEndpoint(endpoint);
  const calls: ClickUpApiMockCall[] = [];
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    void handleClickUpRequest({calls, endpoint: boundEndpoint, request, response}).catch(() => {
      sendJson(response, 400, {err: 'Invalid ClickUp request', ECODE: 'E2E_BAD_REQUEST'});
    });
  });

  try {
    boundEndpoint = await listen(server, endpoint);
  } catch (error) {
    throw new Error(`ClickUp API mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls,
    endpoint: boundEndpoint,
    stop: async () => {
      try {
        await close(server);
      } catch (error) {
        throw new Error(`ClickUp API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

async function handleClickUpRequest(params: {
  calls: ClickUpApiMockCall[];
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

  const taskId = decodeURIComponent(match[1] ?? '');
  const query = Object.fromEntries(requestUrl.searchParams.entries());
  const authorization = params.request.headers.authorization;

  if (params.request.method === 'GET' && !requestUrl.pathname.endsWith('/comment')) {
    params.calls.push({kind: 'get_task', authorization, taskId, query});
    sendJson(params.response, 200, {
      id: taskId,
      name: 'E2E ClickUp task',
      description: CLICKUP_TASK_RESULT_MARKER,
    });
    return;
  }

  if (params.request.method === 'POST' && requestUrl.pathname.endsWith('/comment')) {
    const body = await readJsonBody(params.request);
    const commentBody = isCommentBody(body) ? body : {};
    params.calls.push({
      kind: 'add_comment',
      authorization,
      taskId,
      query,
      body: commentBody,
    });
    sendJson(params.response, 200, {
      id: 'e2e-clickup-comment',
      hist_id: 'e2e-clickup-history',
      date: String(Date.now()),
      marker: CLICKUP_COMMENT_RESULT_MARKER,
    });
    return;
  }

  sendJson(params.response, 405, {err: 'Method not allowed', ECODE: 'E2E_METHOD_NOT_ALLOWED'});
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
}

async function listen(server: HttpServer, endpoint: URL): Promise<URL> {
  server.listen({host: endpoint.hostname, port: Number(endpoint.port)});
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address.');
  const boundEndpoint = new URL(endpoint);
  boundEndpoint.port = String(address.port);
  return boundEndpoint;
}

async function close(server: HttpServer): Promise<void> {
  server.close();
  await once(server, 'close');
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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}
