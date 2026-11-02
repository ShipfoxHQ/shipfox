import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp, listen} from '@shipfox/node-fastify';
import {claimQueuedConversationItems} from '#db/conversations.js';
import {conversationStreamCount} from '#metrics/index.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {turnFactory} from '#test/factories/turn.js';
import {endTurn, storeReply, storeStreamChunk} from '#test/fixtures/conversation-stream.js';
import {createTestProjectsClient} from '#test/fixtures/projects-client.js';
import {createAgentRoutes} from '../index.js';
import {STREAM_HEARTBEAT_INTERVAL_MS} from './stream-conversation.js';

interface TestUser {
  userId: string;
  memberships: UserContextMembership[];
}

const users = new Map<string, TestUser>();

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    const user = users.get(request.headers.authorization ?? '');
    if (!user) throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    setUserContext(
      request,
      buildUserContext({
        userId: user.userId,
        email: 'user@example.com',
        memberships: user.memberships,
      }),
    );
    return Promise.resolve();
  },
};

function member(params: {workspaceId: string}) {
  const user: TestUser = {
    userId: crypto.randomUUID(),
    memberships: [{workspaceId: params.workspaceId, role: 'admin', workspaceStatus: 'active'}],
  };
  const authorization = `Bearer ${user.userId}`;
  users.set(authorization, user);
  return {...user, authorization};
}

const CLIENT_ORIGIN = process.env.CLIENT_BASE_URL ?? 'http://localhost:3000';

/** Reads a live response piece by piece, keeping what it has received. */
function readLive(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = '';
  return {
    async until(isDone: (received: string) => boolean): Promise<string> {
      while (!isDone(received)) {
        const {value, done} = await reader.read();
        if (done) break;
        received += decoder.decode(value, {stream: true});
      }
      return received;
    },
    cancel: () => reader.cancel(),
  };
}

describe('GET /conversations/:conversationId/stream', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  const projects = new Map<string, {workspaceId: string}>();

  async function arrangeConversation() {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    projects.set(projectId, {workspaceId});
    const owner = member({workspaceId});
    const {conversation} = await conversationFactory.create({
      workspaceId,
      projectId,
      ownerUserId: owner.userId,
      body: 'Why did this fail?',
    });
    await claimQueuedConversationItems(conversation.id);
    return {owner, conversation};
  }

  beforeAll(async () => {
    await closeApp();
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createAgentRoutes(undefined as never, {
        projects: createTestProjectsClient({projects}),
        wakeConversation: vi.fn().mockResolvedValue(undefined),
      }),
      swagger: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await closeApp();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('streams the items after the cursor and the final turn, then closes', async () => {
    const {owner, conversation} = await arrangeConversation();
    const turn = await turnFactory.create({conversationId: conversation.id, status: 'running'});
    await storeReply({conversation, turnId: turn.id, modelCallIndex: 0, text: 'Because of X'});
    await endTurn({turnId: turn.id, status: 'succeeded'});

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/stream?after_seq=1`,
      headers: {authorization: owner.authorization},
    });

    const messages = res.body
      .split('\n\n')
      .filter((message) => message !== '' && !message.startsWith(':'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
    expect(messages.map((message) => message.split('\n')[0])).toEqual([
      'event: item',
      'event: turn',
    ]);
    const item = JSON.parse(messages[0]?.split('\ndata: ')[1] ?? '');
    expect(item).toMatchObject({seq: 2, turn_id: turn.id, content: {type: 'rows'}});
    expect(res.body).toContain(
      `data: {"turn_id":"${turn.id}","status":"succeeded","failure_code":null}`,
    );
  });

  it('answers 404 before streaming for a conversation the caller does not own', async () => {
    const {conversation} = await arrangeConversation();
    const stranger = member({workspaceId: conversation.workspaceId});

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/stream`,
      headers: {authorization: stranger.authorization},
    });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json().code).toBe('conversation-not-found');
  });

  it('answers 401 without a user', async () => {
    const {conversation} = await arrangeConversation();

    const res = await app.inject({method: 'GET', url: `/conversations/${conversation.id}/stream`});

    expect(res.statusCode).toBe(401);
  });

  it('rejects a cursor past int4', async () => {
    const {owner, conversation} = await arrangeConversation();

    const res = await app.inject({
      method: 'GET',
      url: `/conversations/${conversation.id}/stream?after_seq=2147483648`,
      headers: {authorization: owner.authorization},
    });

    expect(res.statusCode).toBe(400);
  });

  describe('on a live connection', () => {
    let baseUrl: string;

    beforeAll(async () => {
      baseUrl = await listen({host: '127.0.0.1', port: 0});
    });

    it('carries the CORS headers a hijacked reply would otherwise drop', async () => {
      const {owner, conversation} = await arrangeConversation();
      const controller = new AbortController();

      const res = await fetch(`${baseUrl}/conversations/${conversation.id}/stream?after_seq=1`, {
        headers: {authorization: owner.authorization, origin: CLIENT_ORIGIN},
        signal: controller.signal,
      });
      controller.abort();

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(CLIENT_ORIGIN);
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    });

    it('sends text as it is written, then the stored reply', async () => {
      const {owner, conversation} = await arrangeConversation();
      const turn = await turnFactory.create({conversationId: conversation.id});
      const ids = {conversation, turnId: turn.id, modelCallIndex: 0};
      await storeStreamChunk({...ids, chunkSeq: 0, text: 'Because '});

      const res = await fetch(`${baseUrl}/conversations/${conversation.id}/stream?after_seq=1`, {
        headers: {authorization: owner.authorization},
      });
      const live = readLive(res.body as ReadableStream<Uint8Array>);
      const first = await live.until((received) => received.includes('Because '));
      await storeStreamChunk({...ids, chunkSeq: 1, text: 'of X'});
      await live.until((received) => received.includes('of X'));
      await storeReply({...ids, text: 'Because of X'});
      await endTurn({turnId: turn.id, status: 'succeeded'});
      const all = await live.until(() => false);

      expect(first).toContain('event: reset\ndata: {"reason":"reconnect"}');
      expect(first).toContain('event: delta');
      expect(all).toContain('event: item');
      expect(all).toContain('"status":"succeeded"');
    });

    it('sends a heartbeat comment while the turn is quiet, and counts a disconnect', async () => {
      const {owner, conversation} = await arrangeConversation();
      await turnFactory.create({conversationId: conversation.id});
      const counted = vi.spyOn(conversationStreamCount, 'add');
      vi.useFakeTimers({toFake: ['setInterval']});
      const controller = new AbortController();

      const res = await fetch(`${baseUrl}/conversations/${conversation.id}/stream?after_seq=1`, {
        headers: {authorization: owner.authorization},
        signal: controller.signal,
      });
      const live = readLive(res.body as ReadableStream<Uint8Array>);
      const reading = live.until((received) => received.includes(': heartbeat'));
      await vi.waitFor(() => expect(res.status).toBe(200));
      await vi.advanceTimersByTimeAsync(STREAM_HEARTBEAT_INTERVAL_MS);
      const received = await reading;
      controller.abort();

      expect(received).toContain(': heartbeat\n\n');
      await vi.waitFor(() => expect(counted).toHaveBeenCalledWith(1, {outcome: 'disconnected'}));
    });
  });
});
