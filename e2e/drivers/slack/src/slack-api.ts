import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

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
  | {
      kind: 'conversations.history';
      authorization: string | undefined;
      channel: string | undefined;
      limit: string | undefined;
      cursor: string | undefined;
    }
  | {
      kind: 'conversations.info';
      authorization: string | undefined;
      channel: string | undefined;
    }
  | {
      kind: 'conversations.members';
      authorization: string | undefined;
      channel: string | undefined;
      limit: string | undefined;
      cursor: string | undefined;
    }
  | {
      kind: 'conversations.list';
      authorization: string | undefined;
      types: string | undefined;
      limit: string | undefined;
      cursor: string | undefined;
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

/** A channel the fake serves through `conversations.info`, `.list`, `.members`, and `.history`. */
export interface SlackChannelSeed {
  id: string;
  name: string;
  topic?: string | undefined;
  purpose?: string | undefined;
  isPrivate?: boolean | undefined;
  isArchived?: boolean | undefined;
  /** User IDs, in the order `conversations.members` lists them. */
  members?: readonly string[] | undefined;
  /** Channel messages in any order. `conversations.history` serves them newest first. */
  messages?: readonly Record<string, unknown>[] | undefined;
}

export interface SlackApiMockOptions {
  /**
   * The bot token the API presents, from the connection the spec creates. The fake shares the
   * stack's Slack address with other specs and answers the requests that carry this token.
   */
  botToken?: string | undefined;
  /** Listens here directly instead of behind the stack's router. Unit tests pass port 0. */
  endpoint?: URL | undefined;
  /** Thread pages by the cursor that requests them, `''` for the first page. */
  threadPages?: Readonly<Record<string, SlackThreadPage>> | undefined;
  /** Users `users.info` knows. Any other user ID answers `user_not_found`. */
  users?: Readonly<Record<string, Record<string, unknown>>> | undefined;
}

export interface SlackApiMock {
  calls: SlackApiMockCall[];
  endpoint: URL;
  /** Writes the fake accepted, in arrival order. */
  writes(): RecordedWrite[];
  /** Makes later chat.postMessage calls fail with this Slack error, or succeed again with null. */
  setPostMessageError(error: string | null): void;
  /** Makes `conversations.info`, `.list`, `.members`, and `.history` serve this channel. */
  seedChannel(channel: SlackChannelSeed): void;
  /** Makes `users.info` know this user, by its `id`. */
  seedUser(user: Record<string, unknown> & {id: string}): void;
  /** Makes `conversations.replies` serve these messages, the parent first, for this thread. */
  seedThread(input: {channel: string; ts: string; messages: Record<string, unknown>[]}): void;
  stop(): Promise<void>;
}

interface SlackState {
  channels: Map<string, SlackChannelSeed>;
  users: Map<string, Record<string, unknown>>;
  threads: Map<string, Record<string, unknown>[]>;
}

export async function startSlackApiMock(options: SlackApiMockOptions = {}): Promise<SlackApiMock> {
  const calls: SlackApiMockCall[] = [];
  const writes: RecordedWrite[] = [];
  const failures: {postMessage: string | null} = {postMessage: null};
  const state: SlackState = {
    channels: new Map(),
    users: new Map(Object.entries(options.users ?? {})),
    threads: new Map(),
  };
  let boundEndpoint = new URL('http://127.0.0.1');
  const server = createServer((request, response) => {
    void handleSlackRequest({
      calls,
      writes,
      failures,
      state,
      options,
      endpoint: boundEndpoint,
      request,
      response,
    });
  });

  let listening: ListeningFake;
  try {
    listening = await listenFake({
      server,
      endpoint: options.endpoint,
      stackEndpoint: () => new URL(requiredSlackApiBaseUrl()),
      credentials: [options.botToken],
    });
  } catch (error) {
    throw new Error('Slack API mock failed to start', {cause: error});
  }
  boundEndpoint = listening.endpoint;

  return {
    calls,
    endpoint: boundEndpoint,
    writes: () => [...writes],
    seedChannel: (channel) => {
      state.channels.set(channel.id, channel);
    },
    seedUser: (user) => {
      state.users.set(user.id, user);
    },
    seedThread: ({channel, ts, messages}) => {
      state.threads.set(threadKey({channel, ts}), messages);
    },
    setPostMessageError: (error) => {
      failures.postMessage = error;
    },
    stop: async () => {
      try {
        await listening.close();
      } catch (error) {
        throw new Error(`Slack API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

interface SlackRequestContext {
  calls: SlackApiMockCall[];
  writes: RecordedWrite[];
  failures: {postMessage: string | null};
  state: SlackState;
  options: SlackApiMockOptions;
  response: ServerResponse;
  authorization: string | undefined;
  body: URLSearchParams;
}

const SLACK_METHOD_PATH = /^\/(?:api\/)?/u;

const SLACK_METHOD_HANDLERS: Readonly<Record<string, (context: SlackRequestContext) => void>> = {
  'conversations.replies': handleConversationsReplies,
  'conversations.history': handleConversationsHistory,
  'conversations.info': handleConversationsInfo,
  'conversations.members': handleConversationsMembers,
  'conversations.list': handleConversationsList,
  'users.info': handleUsersInfo,
  'chat.getPermalink': handleGetPermalink,
  'chat.postMessage': handlePostMessage,
};

async function handleSlackRequest(params: {
  calls: SlackApiMockCall[];
  writes: RecordedWrite[];
  failures: {postMessage: string | null};
  state: SlackState;
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
  const channel = context.body.get('channel') ?? undefined;
  const ts = context.body.get('ts') ?? undefined;
  context.calls.push({
    kind: 'conversations.replies',
    authorization: context.authorization,
    channel,
    ts,
    cursor,
  });
  const seeded = context.state.threads.get(threadKey({channel, ts}));
  sendJson(
    context.response,
    200,
    seeded === undefined
      ? threadRepliesBody(context.options, ts ?? null, cursor)
      : {ok: true, messages: seeded, has_more: false},
  );
}

function handleConversationsHistory(context: SlackRequestContext): void {
  const channelId = context.body.get('channel') ?? undefined;
  const cursor = context.body.get('cursor') ?? undefined;
  const limit = context.body.get('limit') ?? undefined;
  context.calls.push({
    kind: 'conversations.history',
    authorization: context.authorization,
    channel: channelId,
    limit,
    cursor,
  });
  const channel = knownChannel(context, channelId);
  if (channel === undefined) return;
  const oldest = Number(context.body.get('oldest') ?? 0);
  const latest = Number(context.body.get('latest') ?? Number.POSITIVE_INFINITY);
  const messages = [...(channel.messages ?? [])]
    .filter((message) => Number(message.ts) > oldest && Number(message.ts) < latest)
    .sort((a, b) => Number(b.ts) - Number(a.ts));
  const page = pageOf({items: messages, limit, cursor});
  if (page === undefined) {
    sendJson(context.response, 200, {ok: false, error: 'invalid_cursor'});
    return;
  }
  sendJson(context.response, 200, {
    ok: true,
    messages: page.items,
    has_more: page.nextCursor !== '',
    pin_count: 0,
    ...(page.nextCursor === '' ? {} : {response_metadata: {next_cursor: page.nextCursor}}),
  });
}

function handleConversationsInfo(context: SlackRequestContext): void {
  const channelId = context.body.get('channel') ?? undefined;
  context.calls.push({
    kind: 'conversations.info',
    authorization: context.authorization,
    channel: channelId,
  });
  const channel = knownChannel(context, channelId);
  if (channel === undefined) return;
  sendJson(context.response, 200, {
    ok: true,
    channel: channelBody({
      channel,
      includeNumMembers: context.body.get('include_num_members') === 'true',
    }),
  });
}

function handleConversationsMembers(context: SlackRequestContext): void {
  const channelId = context.body.get('channel') ?? undefined;
  const cursor = context.body.get('cursor') ?? undefined;
  const limit = context.body.get('limit') ?? undefined;
  context.calls.push({
    kind: 'conversations.members',
    authorization: context.authorization,
    channel: channelId,
    limit,
    cursor,
  });
  const channel = knownChannel(context, channelId);
  if (channel === undefined) return;
  const page = pageOf({items: [...(channel.members ?? [])], limit, cursor});
  if (page === undefined) {
    sendJson(context.response, 200, {ok: false, error: 'invalid_cursor'});
    return;
  }
  sendJson(context.response, 200, {
    ok: true,
    members: page.items,
    response_metadata: {next_cursor: page.nextCursor},
  });
}

function handleConversationsList(context: SlackRequestContext): void {
  const cursor = context.body.get('cursor') ?? undefined;
  const limit = context.body.get('limit') ?? undefined;
  const types = context.body.get('types') ?? undefined;
  context.calls.push({
    kind: 'conversations.list',
    authorization: context.authorization,
    types,
    limit,
    cursor,
  });
  // Slack lists public channels unless the request asks for more.
  const wanted = new Set((types ?? 'public_channel').split(','));
  const excludeArchived = context.body.get('exclude_archived') === 'true';
  const channels = [...context.state.channels.values()]
    .filter((channel) =>
      wanted.has(channel.isPrivate === true ? 'private_channel' : 'public_channel'),
    )
    .filter((channel) => !(excludeArchived && channel.isArchived === true))
    .sort((a, b) => a.id.localeCompare(b.id));
  const page = pageOf({items: channels, limit, cursor});
  if (page === undefined) {
    sendJson(context.response, 200, {ok: false, error: 'invalid_cursor'});
    return;
  }
  sendJson(context.response, 200, {
    ok: true,
    channels: page.items.map((channel) => channelBody({channel, includeNumMembers: true})),
    response_metadata: {next_cursor: page.nextCursor},
  });
}

function handleUsersInfo(context: SlackRequestContext): void {
  const userId = context.body.get('user') ?? undefined;
  context.calls.push({kind: 'users.info', authorization: context.authorization, user: userId});
  const user = userId === undefined ? undefined : context.state.users.get(userId);
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
  context.writes.push({
    kind: 'chat.postMessage',
    target: channel ?? '',
    payload: Object.fromEntries(context.body.entries()),
  });
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

function threadKey({channel, ts}: {channel: string | undefined; ts: string | undefined}): string {
  return `${channel}:${ts}`;
}

function knownChannel(
  context: SlackRequestContext,
  channelId: string | undefined,
): SlackChannelSeed | undefined {
  const channel = channelId === undefined ? undefined : context.state.channels.get(channelId);
  if (channel === undefined) {
    sendJson(context.response, 200, {ok: false, error: 'channel_not_found'});
  }
  return channel;
}

const DEFAULT_PAGE_SIZE = 100;
const CURSOR_PREFIX = 'offset:';

/**
 * One page of `items`. The cursor is the offset of the next page, and `nextCursor` is `''` on the
 * last page, as Slack answers. An unreadable cursor has no page.
 */
function pageOf<T>({
  items,
  limit,
  cursor,
}: {
  items: T[];
  limit: string | undefined;
  cursor: string | undefined;
}): {items: T[]; nextCursor: string} | undefined {
  const size = Number(limit) > 0 ? Number(limit) : DEFAULT_PAGE_SIZE;
  const offset = cursor === undefined ? 0 : Number(cursor.slice(CURSOR_PREFIX.length));
  if (
    cursor !== undefined &&
    (!cursor.startsWith(CURSOR_PREFIX) || !Number.isInteger(offset) || offset < 0)
  ) {
    return undefined;
  }
  const end = offset + size;
  return {
    items: items.slice(offset, end),
    nextCursor: end < items.length ? `${CURSOR_PREFIX}${end}` : '',
  };
}

const CHANNEL_CREATED_AT = 1_700_000_000;

function channelBody({
  channel,
  includeNumMembers,
}: {
  channel: SlackChannelSeed;
  includeNumMembers: boolean;
}): Record<string, unknown> {
  const isPrivate = channel.isPrivate === true;
  return {
    id: channel.id,
    name: channel.name,
    is_channel: !isPrivate,
    is_group: isPrivate,
    is_im: false,
    is_mpim: false,
    is_private: isPrivate,
    created: CHANNEL_CREATED_AT,
    is_archived: channel.isArchived === true,
    is_general: false,
    unlinked: 0,
    name_normalized: channel.name,
    is_shared: false,
    is_org_shared: false,
    is_pending_ext_shared: false,
    pending_shared: [],
    is_ext_shared: false,
    shared_team_ids: [],
    is_member: true,
    creator: channel.members?.[0] ?? '',
    topic: {value: channel.topic ?? '', creator: '', last_set: 0},
    purpose: {value: channel.purpose ?? '', creator: '', last_set: 0},
    previous_names: [],
    ...(includeNumMembers ? {num_members: channel.members?.length ?? 0} : {}),
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
