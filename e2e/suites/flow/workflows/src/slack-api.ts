import {once} from 'node:events';
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';

export const SLACK_REPLIES_MARKER = 'slack-replies-marker';
export const SLACK_POSTED_TS = '1721300000.000002';

export type SlackApiMockCall =
  | {
      kind: 'conversations.replies';
      authorization: string | undefined;
      channel: string | undefined;
      ts: string | undefined;
    }
  | {
      kind: 'chat.postMessage';
      authorization: string | undefined;
      channel: string | undefined;
      threadTs: string | undefined;
      text: string | undefined;
    };

export interface SlackApiMock {
  calls: SlackApiMockCall[];
  endpoint: URL;
  stop(): Promise<void>;
}

export async function startSlackApiMock(
  endpoint = new URL(requiredSlackApiBaseUrl()),
): Promise<SlackApiMock> {
  const calls: SlackApiMockCall[] = [];
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    void handleSlackRequest({calls, endpoint: boundEndpoint, request, response});
  });

  try {
    boundEndpoint = await listen(server, endpoint);
  } catch (error) {
    throw new Error(`Slack API mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls,
    endpoint: boundEndpoint,
    stop: async () => {
      try {
        await close(server);
      } catch (error) {
        throw new Error(`Slack API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

async function handleSlackRequest(params: {
  calls: SlackApiMockCall[];
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const requestUrl = new URL(params.request.url ?? '/', params.endpoint);
  const authorization = params.request.headers.authorization;
  const body = await readFormBody(params.request);

  if (params.request.method === 'POST' && requestUrl.pathname === '/conversations.replies') {
    params.calls.push({
      kind: 'conversations.replies',
      authorization,
      channel: body.get('channel') ?? undefined,
      ts: body.get('ts') ?? undefined,
    });
    sendJson(params.response, 200, {
      ok: true,
      messages: [{type: 'message', ts: body.get('ts'), text: SLACK_REPLIES_MARKER}],
    });
    return;
  }

  if (params.request.method === 'POST' && requestUrl.pathname === '/chat.postMessage') {
    const text = body.get('text') ?? undefined;
    params.calls.push({
      kind: 'chat.postMessage',
      authorization,
      channel: body.get('channel') ?? undefined,
      threadTs: body.get('thread_ts') ?? undefined,
      text,
    });
    sendJson(params.response, 200, {
      ok: true,
      ts: SLACK_POSTED_TS,
      message: {text},
    });
    return;
  }

  sendJson(params.response, 200, {ok: false, error: 'unknown_method'});
}

function requiredSlackApiBaseUrl(): string {
  const endpoint = process.env.SLACK_API_BASE_URL;
  if (!endpoint) throw new Error('SLACK_API_BASE_URL must be configured for the Slack API mock.');
  return endpoint;
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

async function readFormBody(request: NodeJS.ReadableStream): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}
