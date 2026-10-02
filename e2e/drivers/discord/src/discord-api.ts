import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {closeServer, listenOnEndpoint, type RecordedWrite} from '@shipfox/e2e-core';

const DEFAULT_APPLICATION_ID = 'e2e-discord-application-id';
const PUBLIC_THREAD = 11;
const FIRST_MESSAGE_ID = 1_000_000_000_000_000_000n;
const DEFAULT_MESSAGE_LIMIT = 50;
const CHANNEL_PATH = /^\/channels\/([^/]+)$/u;
const MESSAGES_PATH = /^\/channels\/([^/]+)\/messages$/u;
const MESSAGE_PATH = /^\/channels\/([^/]+)\/messages\/([^/]+)$/u;
const THREADS_PATH = /^\/channels\/([^/]+)\/messages\/([^/]+)\/threads$/u;

export interface DiscordApiMockChannel {
  id: string;
  /** Discord's channel type: 0 for a text channel, 11 for a public thread. */
  type: number;
  guild_id: string;
  parent_id?: string | undefined;
  name?: string | undefined;
}

export interface DiscordApiMockMessage {
  id: string;
  channel_id: string;
  content: string;
  author: {id: string; username: string; bot?: boolean};
  timestamp: string;
  /** The thread started from this message, which Discord adds once there is one. */
  thread?: DiscordApiMockChannel | undefined;
}

export interface DiscordApiMockCall {
  method: string;
  path: string;
  authorization: string | undefined;
}

export interface DiscordApiMockOptions {
  endpoint?: URL | undefined;
  /** The bot user that authors the messages the fake accepts. Defaults to `DISCORD_APPLICATION_ID`. */
  botUserId?: string | undefined;
}

export interface DiscordApiMock {
  calls: DiscordApiMockCall[];
  endpoint: URL;
  addChannel(channel: DiscordApiMockChannel): void;
  /** Stores a message a user posted, so the API can read it back. */
  addMessage(message: Omit<DiscordApiMockMessage, 'timestamp'>): DiscordApiMockMessage;
  /** The messages of a channel or thread, oldest first. */
  messages(channelId: string): DiscordApiMockMessage[];
  /** Messages and threads the fake accepted from the bot, in arrival order. */
  writes(): RecordedWrite[];
  stop(): Promise<void>;
}

/** The part of Discord's REST API the Discord tools use, backed by memory. */
export async function startDiscordApiMock(
  options: DiscordApiMockOptions = {},
): Promise<DiscordApiMock> {
  const endpoint = options.endpoint ?? new URL(requiredDiscordApiBaseUrl());
  const state: MockState = {
    botUserId: options.botUserId ?? process.env.DISCORD_APPLICATION_ID ?? DEFAULT_APPLICATION_ID,
    channels: new Map(),
    messages: new Map(),
    nextMessageId: FIRST_MESSAGE_ID,
    calls: [],
    writes: [],
  };
  let boundEndpoint = endpoint;
  const server = createServer((request, response) => {
    void handleRequest({state, endpoint: boundEndpoint, request, response}).catch(
      (error: unknown) => {
        process.stderr.write(`Discord API mock request failed: ${String(error)}\n`);
        if (!response.headersSent) sendDiscordError(response, 400, 'Invalid request');
        else response.end();
      },
    );
  });

  try {
    boundEndpoint = await listenOnEndpoint(server, endpoint);
  } catch (error) {
    throw new Error(`Discord API mock failed to start at ${endpoint}`, {cause: error});
  }

  return {
    calls: state.calls,
    endpoint: boundEndpoint,
    addChannel: (channel) => {
      state.channels.set(channel.id, channel);
    },
    addMessage: (message) => storeMessage(state, message),
    messages: (channelId) => [...(state.messages.get(channelId) ?? [])],
    writes: () => [...state.writes],
    stop: async () => {
      try {
        await closeServer(server);
      } catch (error) {
        throw new Error(`Discord API mock failed to stop at ${boundEndpoint}`, {cause: error});
      }
    },
  };
}

interface MockState {
  botUserId: string;
  channels: Map<string, DiscordApiMockChannel>;
  messages: Map<string, DiscordApiMockMessage[]>;
  nextMessageId: bigint;
  calls: DiscordApiMockCall[];
  writes: RecordedWrite[];
}

interface RouteContext {
  state: MockState;
  url: URL;
  request: IncomingMessage;
  response: ServerResponse;
}

interface Route {
  method: string;
  pattern: RegExp;
  handle(context: RouteContext, args: string[]): Promise<void> | void;
}

const ROUTES: Route[] = [
  {method: 'GET', pattern: CHANNEL_PATH, handle: handleGetChannel},
  {method: 'GET', pattern: MESSAGES_PATH, handle: handleListMessages},
  {method: 'GET', pattern: MESSAGE_PATH, handle: handleGetMessage},
  {method: 'POST', pattern: THREADS_PATH, handle: handleStartThread},
  {method: 'POST', pattern: MESSAGES_PATH, handle: handlePostMessage},
];

async function handleRequest(params: {
  state: MockState;
  endpoint: URL;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const {state, request, response} = params;
  const url = new URL(request.url ?? '/', params.endpoint);
  const method = request.method ?? 'GET';
  state.calls.push({method, path: url.pathname, authorization: request.headers.authorization});

  for (const route of ROUTES) {
    const match = route.method === method ? url.pathname.match(route.pattern) : null;
    if (match) {
      await route.handle({state, url, request, response}, match.slice(1).map(decodeURIComponent));
      return;
    }
  }
  sendDiscordError(response, 404, '404: Not Found');
}

function handleGetChannel({state, response}: RouteContext, [channelId = '']: string[]): void {
  const channel = state.channels.get(channelId);
  if (channel) sendJson(response, 200, channel);
  else sendDiscordError(response, 404, 'Unknown Channel', 10_003);
}

function handleListMessages(
  {state, url, response}: RouteContext,
  [channelId = '']: string[],
): void {
  const limit = Number(url.searchParams.get('limit') ?? DEFAULT_MESSAGE_LIMIT);
  // Discord answers newest first.
  const newestFirst = [...(state.messages.get(channelId) ?? [])].reverse();
  sendJson(response, 200, newestFirst.slice(0, limit));
}

function handleGetMessage(
  {state, response}: RouteContext,
  [channelId = '', messageId = '']: string[],
): void {
  const message = state.messages.get(channelId)?.find((entry) => entry.id === messageId);
  if (message) sendJson(response, 200, message);
  else sendDiscordError(response, 404, 'Unknown Message', 10_008);
}

async function handleStartThread(
  {state, request, response}: RouteContext,
  [channelId = '', messageId = '']: string[],
): Promise<void> {
  const body = await readJsonBody(request);
  startThread(state, response, {
    channelId,
    messageId,
    name: typeof body.name === 'string' ? body.name : 'Thread',
  });
}

async function handlePostMessage(
  {state, request, response}: RouteContext,
  [channelId = '']: string[],
): Promise<void> {
  postMessage(state, response, {channelId, body: await readJsonBody(request)});
}

function startThread(
  state: MockState,
  response: ServerResponse,
  input: {channelId: string; messageId: string; name: string},
): void {
  const parent = state.channels.get(input.channelId);
  const message = state.messages
    .get(input.channelId)
    ?.find((entry) => entry.id === input.messageId);
  if (!parent || !message) {
    sendDiscordError(response, 404, 'Unknown Message', 10_008);
    return;
  }
  if (message.thread) {
    sendDiscordError(response, 400, 'A thread has already been created for this message', 160_004);
    return;
  }
  // A thread started from a message takes that message's id.
  const thread: DiscordApiMockChannel = {
    id: message.id,
    type: PUBLIC_THREAD,
    guild_id: parent.guild_id,
    parent_id: parent.id,
    name: input.name,
  };
  state.channels.set(thread.id, thread);
  message.thread = thread;
  state.writes.push({
    kind: 'create_thread',
    target: `${input.channelId}/${input.messageId}`,
    payload: {name: input.name},
  });
  sendJson(response, 201, thread);
}

function postMessage(
  state: MockState,
  response: ServerResponse,
  input: {channelId: string; body: Record<string, unknown>},
): void {
  if (!state.channels.has(input.channelId)) {
    sendDiscordError(response, 404, 'Unknown Channel', 10_003);
    return;
  }
  const content = typeof input.body.content === 'string' ? input.body.content : '';
  const message = storeMessage(state, {
    id: nextMessageId(state),
    channel_id: input.channelId,
    content,
    author: {id: state.botUserId, username: 'Shipfox', bot: true},
  });
  state.writes.push({
    kind: 'create_message',
    target: input.channelId,
    payload: {content, ...(input.body.message_reference ? {reply: true} : {})},
  });
  sendJson(response, 200, message);
}

function storeMessage(
  state: MockState,
  message: Omit<DiscordApiMockMessage, 'timestamp'>,
): DiscordApiMockMessage {
  const stored = {...message, timestamp: new Date().toISOString()};
  state.messages.set(message.channel_id, [
    ...(state.messages.get(message.channel_id) ?? []),
    stored,
  ]);
  return stored;
}

function nextMessageId(state: MockState): string {
  const id = state.nextMessageId;
  state.nextMessageId += 1n;
  return String(id);
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
}

function sendDiscordError(
  response: ServerResponse,
  statusCode: number,
  message: string,
  code = 0,
): void {
  sendJson(response, statusCode, {message, code});
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {'content-type': 'application/json'}).end(JSON.stringify(body));
}

function requiredDiscordApiBaseUrl(): string {
  const endpoint = process.env.DISCORD_API_BASE_URL;
  if (!endpoint) {
    throw new Error('DISCORD_API_BASE_URL must be configured for the Discord API mock.');
  }
  return endpoint;
}
