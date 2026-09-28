import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {closeServer, listenOnEndpoint} from './mock-server.js';

export const SLACK_REPLIES_MARKER = 'slack-replies-marker';
export const SLACK_POSTED_TS = '1721300000.000002';

export type SlackApiMockCall =
  | {
      kind: 'conversations.replies';
      authorization: string | undefined;
      channel: string | undefined;
      ts: string | undefined;
      cursor?: string | undefined;
    }
  | {kind: 'users.info'; authorization: string | undefined; user: string | undefined}
  | {
      kind: 'chat.getPermalink';
      authorization: string | undefined;
      channel: string | undefined;
      messageTs: string | undefined;
    }
  | {
      kind: 'chat.postMessage';
      authorization: string | undefined;
      channel: string | undefined;
      threadTs: string | undefined;
      text: string | undefined;
    };

export interface SlackThreadPage {
  messages: Record<string, unknown>[];
  nextCursor?: string | undefined;
}

export interface SlackApiMockOptions {
  endpoint?: URL | undefined;
  /** Thread pages by the cursor that requests them, `''` for the first page. */
  threadPages?: Readonly<Record<string, SlackThreadPage>> | undefined;
  /** Users `users.info` knows. Any other user ID answers `user_not_found`. */
  users?: Readonly<Record<string, Record<string, unknown>>> | undefined;
}

export interface SlackApiMock {
  calls: SlackApiMockCall[];
  endpoint: URL;
  /** Makes later chat.postMessage calls fail with this Slack error, or succeed again with null. */
  setPostMessageError(error: string | null): void;
  stop(): Promise<void>;
}

export async function startSlackApiMock(options: SlackApiMockOptions = {}): Promise<SlackApiMock> {
  const endpoint = options.endpoint ?? new URL(requiredSlackApiBaseUrl());
  const calls: SlackApiMockCall[] = [];
  const failures: {postMessage: string | null} = {postMessage: null};
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    void handleSlackRequest({
      calls,
      failures,
      options,
      endpoint: boundEndpoint,
      request,
      response,
    });
  });

  try {
    boundEndpoint = await listenOnEndpoint(server, endpoint);
  } catch (error) {
    throw new Error(`Slack API mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls,
    endpoint: boundEndpoint,
    setPostMessageError: (error) => {
      failures.postMessage = error;
    },
    stop: async () => {
      try {
        await closeServer(server);
      } catch (error) {
        throw new Error(`Slack API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

interface SlackRequestContext {
  calls: SlackApiMockCall[];
  failures: {postMessage: string | null};
  options: SlackApiMockOptions;
  response: ServerResponse;
  authorization: string | undefined;
  body: URLSearchParams;
}

const SLACK_METHOD_PATH = /^\/(?:api\/)?/u;

const SLACK_METHOD_HANDLERS: Readonly<Record<string, (context: SlackRequestContext) => void>> = {
  'conversations.replies': handleConversationsReplies,
  'users.info': handleUsersInfo,
  'chat.getPermalink': handleGetPermalink,
  'chat.postMessage': handlePostMessage,
};

async function handleSlackRequest(params: {
  calls: SlackApiMockCall[];
  failures: {postMessage: string | null};
  options: SlackApiMockOptions;
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const {pathname} = new URL(params.request.url ?? '/', params.endpoint);
  const method = pathname.replace(SLACK_METHOD_PATH, '');
  const handler = params.request.method === 'POST' ? SLACK_METHOD_HANDLERS[method] : undefined;
  const body = await readFormBody(params.request);
  if (handler === undefined) {
    sendJson(params.response, 200, {ok: false, error: 'unknown_method'});
    return;
  }
  handler({...params, authorization: params.request.headers.authorization, body});
}

function handleConversationsReplies(context: SlackRequestContext): void {
  const cursor = context.body.get('cursor') ?? undefined;
  context.calls.push({
    kind: 'conversations.replies',
    authorization: context.authorization,
    channel: context.body.get('channel') ?? undefined,
    ts: context.body.get('ts') ?? undefined,
    cursor,
  });
  sendJson(
    context.response,
    200,
    threadRepliesBody(context.options, context.body.get('ts'), cursor),
  );
}

function handleUsersInfo(context: SlackRequestContext): void {
  const userId = context.body.get('user') ?? undefined;
  context.calls.push({kind: 'users.info', authorization: context.authorization, user: userId});
  const user = userId === undefined ? undefined : context.options.users?.[userId];
  sendJson(
    context.response,
    200,
    user === undefined ? {ok: false, error: 'user_not_found'} : {ok: true, user},
  );
}

function handleGetPermalink(context: SlackRequestContext): void {
  const channel = context.body.get('channel') ?? undefined;
  const messageTs = context.body.get('message_ts') ?? undefined;
  context.calls.push({
    kind: 'chat.getPermalink',
    authorization: context.authorization,
    channel,
    messageTs,
  });
  sendJson(context.response, 200, {
    ok: true,
    channel,
    permalink: `https://e2e.slack.com/archives/${channel}/p${messageTs?.replace('.', '')}`,
  });
}

function handlePostMessage(context: SlackRequestContext): void {
  const text = context.body.get('text') ?? undefined;
  const channel = context.body.get('channel') ?? undefined;
  context.calls.push({
    kind: 'chat.postMessage',
    authorization: context.authorization,
    channel,
    threadTs: context.body.get('thread_ts') ?? undefined,
    text,
  });
  if (context.failures.postMessage !== null) {
    sendJson(context.response, 200, {ok: false, error: context.failures.postMessage});
    return;
  }
  sendJson(context.response, 200, {ok: true, channel, ts: SLACK_POSTED_TS, message: {text}});
}

function threadRepliesBody(
  options: SlackApiMockOptions,
  ts: string | null,
  cursor: string | undefined,
): Record<string, unknown> {
  if (options.threadPages === undefined) {
    return {ok: true, messages: [{type: 'message', ts, text: SLACK_REPLIES_MARKER}]};
  }
  const page = options.threadPages[cursor ?? ''];
  if (page === undefined) return {ok: false, error: 'invalid_cursor'};
  return {
    ok: true,
    messages: page.messages,
    has_more: page.nextCursor !== undefined,
    response_metadata: {next_cursor: page.nextCursor ?? ''},
  };
}

function requiredSlackApiBaseUrl(): string {
  const endpoint = process.env.SLACK_API_BASE_URL;
  if (!endpoint) throw new Error('SLACK_API_BASE_URL must be configured for the Slack API mock.');
  return endpoint;
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
