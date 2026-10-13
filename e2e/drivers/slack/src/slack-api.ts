import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {type ListeningFake, listenFake, type RecordedWrite} from '@shipfox/e2e-core';

export const SLACK_REPLIES_MARKER = 'slack-replies-marker';
const MESSAGE_TS_SECONDS = '1721300000';
const FIRST_MESSAGE_SEQUENCE = 2;
/** The `ts` of the first message the fake accepts. Later messages count up from it. */
export const SLACK_POSTED_TS = messageTs(FIRST_MESSAGE_SEQUENCE);
const DEFAULT_BOT_USER_ID = 'U0BOT';

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
    }
  | {
      kind: 'chat.update';
      authorization: string | undefined;
      channel: string | undefined;
      ts: string | undefined;
      text: string | undefined;
    }
  | {
      kind: 'reactions.add';
      authorization: string | undefined;
      channel: string | undefined;
      timestamp: string | undefined;
      name: string | undefined;
    }
  | {
      kind: 'chat.scheduleMessage';
      authorization: string | undefined;
      channel: string | undefined;
      postAt: string | undefined;
      text: string | undefined;
    }
  | {
      kind: 'chat.scheduledMessages.list';
      authorization: string | undefined;
      channel: string | undefined;
      oldest: string | undefined;
      latest: string | undefined;
      limit: string | undefined;
      cursor: string | undefined;
    }
  | {kind: 'canvases.create'; authorization: string | undefined; title: string | undefined}
  | {
      kind: 'canvases.sections.lookup';
      authorization: string | undefined;
      canvasId: string | undefined;
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
  /** The user the bot's messages and reactions come from. Defaults to `U0BOT`. */
  botUserId?: string | undefined;
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
  /**
   * Writes the fake accepted, in arrival order: `chat.postMessage`, `chat.update`, `reactions.add`,
   * `chat.scheduleMessage`, and `canvases.create`.
   */
  writes(): RecordedWrite[];
  /** Makes later chat.postMessage calls fail with this Slack error, or succeed again with null. */
  setPostMessageError(error: string | null): void;
  /**
   * Makes `conversations.info`, `.list`, `.members`, and `.history` serve this channel. Writes land
   * on its messages, so reads after them return the change.
   */
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
  /** Each channel's messages, seeded or accepted, with thread replies among them. */
  messages: Map<string, Record<string, unknown>[]>;
  scheduled: ScheduledMessage[];
  canvases: Map<string, SlackCanvas>;
  /** How many messages, scheduled messages, and canvases the fake has created. */
  sequence: {message: number; scheduled: number; canvas: number};
}

interface ScheduledMessage {
  id: string;
  channelId: string;
  postAt: number;
  dateCreated: number;
  text: string;
}

interface SlackCanvas {
  id: string;
  title: string;
  markdown: string;
}

export async function startSlackApiMock(options: SlackApiMockOptions = {}): Promise<SlackApiMock> {
  const calls: SlackApiMockCall[] = [];
  const writes: RecordedWrite[] = [];
  const failures: {postMessage: string | null} = {postMessage: null};
  const state: SlackState = {
    channels: new Map(),
    users: new Map(Object.entries(options.users ?? {})),
    threads: new Map(),
    messages: new Map(),
    scheduled: [],
    canvases: new Map(),
    sequence: {message: FIRST_MESSAGE_SEQUENCE, scheduled: 0, canvas: 0},
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
      state.messages.set(
        channel.id,
        (channel.messages ?? []).map((message) => ({...message})),
      );
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
  'chat.update': handleUpdateMessage,
  'reactions.add': handleAddReaction,
  'chat.scheduleMessage': handleScheduleMessage,
  'chat.scheduledMessages.list': handleScheduledMessagesList,
  'canvases.create': handleCreateCanvas,
  'canvases.sections.lookup': handleCanvasSectionsLookup,
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
  const thread = threadMessages({state: context.state, channel, ts});
  sendJson(
    context.response,
    200,
    thread === undefined
      ? threadRepliesBody(context.options, ts ?? null, cursor)
      : {ok: true, messages: thread, has_more: false},
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
  const messages = [...(context.state.messages.get(channel.id) ?? [])]
    .filter((message) => message.thread_ts === undefined || message.thread_ts === message.ts)
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
  const threadTs = context.body.get('thread_ts') ?? undefined;
  context.calls.push({
    kind: 'chat.postMessage',
    authorization: context.authorization,
    channel,
    threadTs,
    text,
  });
  if (context.failures.postMessage !== null) {
    sendJson(context.response, 200, {ok: false, error: context.failures.postMessage});
    return;
  }
  const ts = messageTs(context.state.sequence.message++);
  const message = {
    type: 'message',
    user: botUserId(context),
    text,
    ts,
    ...jsonField(context.body, 'blocks'),
    ...(threadTs === undefined ? {} : {thread_ts: threadTs}),
  };
  const messages = context.state.messages.get(channel ?? '') ?? [];
  context.state.messages.set(channel ?? '', [...messages, message]);
  if (threadTs !== undefined) noteReply({messages, threadTs, reply: message});
  recordWrite(context, {kind: 'chat.postMessage', target: channel ?? ''});
  sendJson(context.response, 200, {ok: true, channel, ts, message});
}

function handleUpdateMessage(context: SlackRequestContext): void {
  const channel = context.body.get('channel') ?? undefined;
  const ts = context.body.get('ts') ?? undefined;
  const text = context.body.get('text') ?? undefined;
  context.calls.push({
    kind: 'chat.update',
    authorization: context.authorization,
    channel,
    ts,
    text,
  });
  const matches = existingMessages(context, {channel, ts});
  if (matches === undefined) return;
  const edit = {
    text,
    ...jsonField(context.body, 'blocks'),
    edited: {user: botUserId(context), ts: messageTs(context.state.sequence.message++)},
  };
  for (const message of matches) Object.assign(message, edit);
  recordWrite(context, {kind: 'chat.update', target: `${channel}/${ts}`});
  sendJson(context.response, 200, {ok: true, channel, ts, text, message: matches[0]});
}

function handleAddReaction(context: SlackRequestContext): void {
  const channel = context.body.get('channel') ?? undefined;
  const timestamp = context.body.get('timestamp') ?? undefined;
  const name = context.body.get('name') ?? undefined;
  context.calls.push({
    kind: 'reactions.add',
    authorization: context.authorization,
    channel,
    timestamp,
    name,
  });
  const matches = existingMessages(context, {channel, ts: timestamp});
  if (matches === undefined) return;
  const user = botUserId(context);
  const reactions = (matches[0]?.reactions ?? []) as SlackReaction[];
  const existing = reactions.find((reaction) => reaction.name === name);
  if (existing?.users.includes(user)) {
    sendJson(context.response, 200, {ok: false, error: 'already_reacted'});
    return;
  }
  for (const message of matches) {
    message.reactions = [
      ...((message.reactions ?? []) as SlackReaction[]).filter(
        (reaction) => reaction.name !== name,
      ),
      {
        name,
        count: (existing?.count ?? 0) + 1,
        users: [...(existing?.users ?? []), user],
      },
    ];
  }
  recordWrite(context, {kind: 'reactions.add', target: `${channel}/${timestamp}`});
  sendJson(context.response, 200, {ok: true});
}

interface SlackReaction {
  name: string;
  count: number;
  users: string[];
}

function handleScheduleMessage(context: SlackRequestContext): void {
  const channel = context.body.get('channel') ?? undefined;
  const postAt = context.body.get('post_at') ?? undefined;
  const text = context.body.get('text') ?? undefined;
  context.calls.push({
    kind: 'chat.scheduleMessage',
    authorization: context.authorization,
    channel,
    postAt,
    text,
  });
  if (!Number.isInteger(Number(postAt))) {
    sendJson(context.response, 200, {ok: false, error: 'invalid_time'});
    return;
  }
  const scheduled: ScheduledMessage = {
    id: `Q${String(++context.state.sequence.scheduled).padStart(10, '0')}`,
    channelId: channel ?? '',
    postAt: Number(postAt),
    dateCreated: Math.floor(Date.now() / 1000),
    text: text ?? '',
  };
  context.state.scheduled.push(scheduled);
  recordWrite(context, {kind: 'chat.scheduleMessage', target: channel ?? ''});
  sendJson(context.response, 200, {
    ok: true,
    channel,
    scheduled_message_id: scheduled.id,
    post_at: scheduled.postAt,
    message: {type: 'delayed_message', user: botUserId(context), text: scheduled.text},
  });
}

function handleScheduledMessagesList(context: SlackRequestContext): void {
  const channel = context.body.get('channel') ?? undefined;
  const oldest = context.body.get('oldest') ?? undefined;
  const latest = context.body.get('latest') ?? undefined;
  const limit = context.body.get('limit') ?? undefined;
  const cursor = context.body.get('cursor') ?? undefined;
  context.calls.push({
    kind: 'chat.scheduledMessages.list',
    authorization: context.authorization,
    channel,
    oldest,
    latest,
    limit,
    cursor,
  });
  // Slack includes both ends of the `post_at` range.
  const scheduled = context.state.scheduled
    .filter((message) => channel === undefined || message.channelId === channel)
    .filter((message) => oldest === undefined || message.postAt >= Number(oldest))
    .filter((message) => latest === undefined || message.postAt <= Number(latest))
    .sort((a, b) => a.postAt - b.postAt);
  const page = pageOf({items: scheduled, limit, cursor});
  if (page === undefined) {
    sendJson(context.response, 200, {ok: false, error: 'invalid_cursor'});
    return;
  }
  sendJson(context.response, 200, {
    ok: true,
    scheduled_messages: page.items.map((message) => ({
      id: message.id,
      channel_id: message.channelId,
      post_at: message.postAt,
      date_created: message.dateCreated,
      text: message.text,
    })),
    response_metadata: {next_cursor: page.nextCursor},
  });
}

function handleCreateCanvas(context: SlackRequestContext): void {
  const title = context.body.get('title') ?? undefined;
  context.calls.push({kind: 'canvases.create', authorization: context.authorization, title});
  const content = jsonValue(context.body, 'document_content') as {markdown?: unknown} | undefined;
  if (typeof content?.markdown !== 'string') {
    sendJson(context.response, 200, {ok: false, error: 'invalid_arguments'});
    return;
  }
  const canvas: SlackCanvas = {
    id: `F${String(++context.state.sequence.canvas).padStart(10, '0')}`,
    title: title ?? '',
    markdown: content.markdown,
  };
  context.state.canvases.set(canvas.id, canvas);
  recordWrite(context, {kind: 'canvases.create', target: canvas.id});
  sendJson(context.response, 200, {ok: true, canvas_id: canvas.id});
}

function handleCanvasSectionsLookup(context: SlackRequestContext): void {
  const canvasId = context.body.get('canvas_id') ?? undefined;
  context.calls.push({
    kind: 'canvases.sections.lookup',
    authorization: context.authorization,
    canvasId,
  });
  const canvas = canvasId === undefined ? undefined : context.state.canvases.get(canvasId);
  if (canvas === undefined) {
    sendJson(context.response, 200, {ok: false, error: 'canvas_not_found'});
    return;
  }
  const criteria = (jsonValue(context.body, 'criteria') ?? {}) as {
    contains_text?: string;
    section_types?: string[];
  };
  const sections = canvasSections(canvas)
    .filter(
      (section) =>
        criteria.contains_text === undefined || section.text.includes(criteria.contains_text),
    )
    .filter(
      (section) =>
        criteria.section_types === undefined ||
        criteria.section_types.includes(section.type) ||
        (section.type !== 'other' && criteria.section_types.includes('any_header')),
    );
  sendJson(context.response, 200, {ok: true, sections: sections.map(({id}) => ({id}))});
}

const BLANK_LINE = /\n\s*\n/u;
const HEADING = /^(#{1,3})\s/u;

/** A canvas section is a block of the Markdown, set apart by blank lines. */
function canvasSections(canvas: SlackCanvas): {id: string; type: string; text: string}[] {
  return canvas.markdown
    .split(BLANK_LINE)
    .map((block) => block.trim())
    .filter((block) => block !== '')
    .map((text, index) => ({
      id: `temp:C:${canvas.id}${String(index).padStart(3, '0')}`,
      type: headingType(text),
      text,
    }));
}

function headingType(block: string): string {
  const level = HEADING.exec(block)?.[1]?.length;
  return level === undefined ? 'other' : `h${level}`;
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

/**
 * The parent and replies of the thread at `ts`: the seeded thread if there is one, with the
 * replies posted to it since, or the posted message alone. Undefined for a message the fake does
 * not hold.
 */
function threadMessages({
  state,
  channel,
  ts,
}: {
  state: SlackState;
  channel: string | undefined;
  ts: string | undefined;
}): Record<string, unknown>[] | undefined {
  const stored = state.messages.get(channel ?? '') ?? [];
  const seeded = state.threads.get(threadKey({channel, ts}));
  const base = seeded ?? stored.filter((message) => message.ts === ts);
  if (base.length === 0) return undefined;
  const posted = stored
    .filter((message) => message.thread_ts === ts && message.ts !== ts)
    .filter((message) => !base.some((known) => known.ts === message.ts))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  return [...base, ...posted];
}

/** Every copy of the message at `ts` in the channel, or undefined once it has answered the error. */
function existingMessages(
  context: SlackRequestContext,
  {channel, ts}: {channel: string | undefined; ts: string | undefined},
): Record<string, unknown>[] | undefined {
  const stored = context.state.messages.get(channel ?? '');
  if (stored === undefined && !context.state.channels.has(channel ?? '')) {
    sendJson(context.response, 200, {ok: false, error: 'channel_not_found'});
    return undefined;
  }
  const threads = [...context.state.threads.entries()]
    .filter(([key]) => key.startsWith(`${channel}:`))
    .flatMap(([, messages]) => messages);
  const matches = [...(stored ?? []), ...threads].filter((message) => message.ts === ts);
  if (matches.length === 0) {
    sendJson(context.response, 200, {ok: false, error: 'message_not_found'});
    return undefined;
  }
  return matches;
}

/** Counts a reply on its parent, as Slack does on the thread's root message. */
function noteReply({
  messages,
  threadTs,
  reply,
}: {
  messages: Record<string, unknown>[];
  threadTs: string;
  reply: Record<string, unknown>;
}): void {
  const parent = messages.find((message) => message.ts === threadTs);
  if (parent === undefined) return;
  const users = new Set((parent.reply_users ?? []) as unknown[]);
  users.add(reply.user);
  Object.assign(parent, {
    thread_ts: threadTs,
    reply_count: Number(parent.reply_count ?? 0) + 1,
    reply_users: [...users],
    reply_users_count: users.size,
    latest_reply: reply.ts,
  });
}

function messageTs(sequence: number): string {
  return `${MESSAGE_TS_SECONDS}.${String(sequence).padStart(6, '0')}`;
}

function botUserId(context: SlackRequestContext): string {
  return context.options.botUserId ?? DEFAULT_BOT_USER_ID;
}

function recordWrite(
  context: SlackRequestContext,
  {kind, target}: {kind: string; target: string},
): void {
  context.writes.push({kind, target, payload: Object.fromEntries(context.body.entries())});
}

/** The parsed JSON form field, or undefined when it is absent or unreadable. */
function jsonValue(body: URLSearchParams, field: string): unknown {
  const raw = body.get(field);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** The field as a property of its own name, for a spread into a message that may lack it. */
function jsonField(body: URLSearchParams, field: string): Record<string, unknown> {
  const value = jsonValue(body, field);
  return value === undefined ? {} : {[field]: value};
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
