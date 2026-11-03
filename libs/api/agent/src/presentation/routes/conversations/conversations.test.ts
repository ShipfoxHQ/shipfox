import {CONVERSATION_MESSAGE_MAX_BYTES} from '@shipfox/api-agent-dto';
import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {and, eq} from 'drizzle-orm';
import {claimQueuedConversationItems, getRunningTurn} from '#db/conversations.js';
import {db} from '#db/db.js';
import {conversationItems} from '#db/schema/conversation-items.js';
import {conversations} from '#db/schema/conversations.js';
import {sessionDataKeys} from '#db/schema/data-keys.js';
import {getTurnById} from '#db/turn-runtime.js';
import {conversationFactory} from '#test/factories/conversation.js';
import {turnFactory} from '#test/factories/turn.js';
import {appendConversationEntry} from '#test/fixtures/conversation-entries.js';
import {createTestProjectsClient} from '#test/fixtures/projects-client.js';
import {createAgentRoutes} from '../index.js';

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

describe('conversation routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  const projects = new Map<string, {workspaceId: string}>();
  const wake = vi.fn<(conversationId: string) => Promise<void>>();

  function arrangeProject() {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    projects.set(projectId, {workspaceId});
    return {workspaceId, projectId};
  }

  async function arrangeUnreadableDataKey(workspaceId: string) {
    await db().insert(sessionDataKeys).values({
      workspaceId,
      wrappedDek: 'not-a-wrapped-key',
      kekVersion: 'not-a-key-version',
    });
  }

  function message(overrides: Record<string, unknown> = {}) {
    return {client_message_id: crypto.randomUUID(), body: 'Why did this fail?', ...overrides};
  }

  beforeAll(async () => {
    await closeApp();
    app = await createApp({
      auth: [fakeUserAuth],
      routes: createAgentRoutes(undefined as never, {
        projects: createTestProjectsClient({projects}),
        wakeConversation: wake,
      }),
      swagger: false,
    });
    await app.ready();
  });

  beforeEach(() => {
    wake.mockReset();
    wake.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('POST /projects/:projectId/conversations', () => {
    it('wakes the conversation once its first message is committed', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
        payload: message(),
      });

      expect(res.statusCode).toBe(201);
      expect(wake).toHaveBeenCalledExactlyOnceWith(res.json().conversation.id);
    });

    it('creates a conversation owned by the caller, with its first message queued', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const pageContext = {page: 'run', run_id: crypto.randomUUID()};
      const payload = message({page_context: pageContext});

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
        payload,
      });

      const stored = await db()
        .select()
        .from(conversations)
        .where(eq(conversations.id, res.json().conversation.id));
      expect(res.statusCode).toBe(201);
      expect(res.json().conversation).toMatchObject({
        project_id: projectId,
        agent_key: 'shippy',
        title: 'Why did this fail?',
        unread: false,
      });
      expect(res.json().item).toMatchObject({
        seq: null,
        entry_type: 'message',
        author_user_id: owner.userId,
        client_message_id: payload.client_message_id,
        content: {
          type: 'rows',
          rows: [{kind: 'message', role: 'user', text: 'Why did this fail?'}],
        },
      });
      expect(stored[0]).toMatchObject({
        workspaceId,
        originKind: 'web',
        ownerUserId: owner.userId,
      });
    });

    it('returns the stored conversation for a retried create', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const payload = message();
      const create = () =>
        app.inject({
          method: 'POST',
          url: `/projects/${projectId}/conversations`,
          headers: {authorization: owner.authorization},
          payload,
        });

      const first = await create();
      const retry = await create();

      const stored = await db()
        .select()
        .from(conversations)
        .where(eq(conversations.projectId, projectId));
      expect(retry.statusCode).toBe(201);
      expect(retry.json().conversation.id).toBe(first.json().conversation.id);
      expect(retry.json().item.id).toBe(first.json().item.id);
      expect(stored).toHaveLength(1);
    });

    it('returns 503 when the workspace key cannot be read', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      await arrangeUnreadableDataKey(workspaceId);

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
        payload: message(),
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('conversation-unavailable');
    });

    it('rejects a caller from another workspace', async () => {
      const {projectId} = arrangeProject();
      const outsider = member({workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: outsider.authorization},
        payload: message(),
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 404 for an unknown project', async () => {
      const caller = member({workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${crypto.randomUUID()}/conversations`,
        headers: {authorization: caller.authorization},
        payload: message(),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('project-not-found');
    });

    it('returns 401 without a user', async () => {
      const {projectId} = arrangeProject();

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/conversations`,
        payload: message(),
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /projects/:projectId/conversations', () => {
    it("lists only the caller's own web conversations in the project", async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const colleague = member({workspaceId});
      const mine = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      await conversationFactory.create({workspaceId, projectId, ownerUserId: colleague.userId});
      await conversationFactory.create({
        workspaceId,
        projectId: arrangeProject().projectId,
        ownerUserId: owner.userId,
      });

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().conversations.map((c: {id: string}) => c.id)).toEqual([
        mine.conversation.id,
      ]);
    });

    it('ignores owner and origin parameters', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const admin = member({workspaceId});
      await conversationFactory.create({workspaceId, projectId, ownerUserId: owner.userId});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations?owner_user_id=${owner.userId}&origin_kind=integration`,
        headers: {authorization: admin.authorization},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().conversations).toEqual([]);
    });

    it('pages by latest activity', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const scope = {workspaceId, projectId, ownerUserId: owner.userId};
      const oldest = await conversationFactory.create(scope);
      const middle = await conversationFactory.create(scope);
      const newest = await conversationFactory.create(scope);

      const first = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations?limit=2`,
        headers: {authorization: owner.authorization},
      });
      const second = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations?limit=2&cursor=${first.json().next_cursor}`,
        headers: {authorization: owner.authorization},
      });

      expect(first.json().conversations.map((c: {id: string}) => c.id)).toEqual([
        newest.conversation.id,
        middle.conversation.id,
      ]);
      expect(second.json().conversations.map((c: {id: string}) => c.id)).toEqual([
        oldest.conversation.id,
      ]);
      expect(second.json().next_cursor).toBeNull();
    });

    it('rejects an invalid cursor', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations?cursor=nope`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid-cursor');
    });

    it('rejects a cursor whose id is not a UUID', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const cursor = encodeTimestampIdCursor({createdAt: new Date(), id: 'not-a-uuid'});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations?cursor=${cursor}`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('invalid-cursor');
    });

    it('keeps listing around an unreadable title', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const scope = {workspaceId, projectId, ownerUserId: owner.userId};
      const broken = await conversationFactory.create(scope);
      const readable = await conversationFactory.create({...scope, body: 'Still readable'});
      await db()
        .update(conversations)
        .set({title: Buffer.from('not sealed'), lastSeq: 1, lastAgentSeq: 1})
        .where(eq(conversations.id, broken.conversation.id));

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
      });

      const titles = new Map(
        res.json().conversations.map((c: {id: string; title: string | null}) => [c.id, c.title]),
      );
      expect(res.statusCode).toBe(200);
      expect(titles.get(broken.conversation.id)).toBeNull();
      expect(titles.get(readable.conversation.id)).toBe('Still readable');
      expect(res.json().unread_count).toBe(1);
    });

    it('returns 503 when the workspace key cannot be read', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      await arrangeUnreadableDataKey(workspaceId);

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('conversation-unavailable');
    });

    it('reports unread state and a total count across pages', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const scope = {workspaceId, projectId, ownerUserId: owner.userId};
      const unread = await conversationFactory.create(scope);
      await conversationFactory.create(scope);
      await db()
        .update(conversations)
        .set({lastSeq: 2, lastAgentSeq: 2})
        .where(eq(conversations.id, unread.conversation.id));

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations?limit=1`,
        headers: {authorization: owner.authorization},
      });

      expect(res.json().unread_count).toBe(1);
      expect(res.json().conversations).toHaveLength(1);
    });
  });

  describe.each([
    {method: 'GET' as const, path: (id: string) => `/conversations/${id}`},
    {method: 'GET' as const, path: (id: string) => `/conversations/${id}/items`},
    {method: 'DELETE' as const, path: (id: string) => `/conversations/${id}`},
    {
      method: 'POST' as const,
      path: (id: string) => `/conversations/${id}/messages`,
      payload: {client_message_id: '11111111-1111-4111-8111-111111111111', body: 'Hello'},
    },
    {
      method: 'POST' as const,
      path: (id: string) => `/conversations/${id}/read`,
      payload: {last_read_seq: 0},
    },
    {method: 'POST' as const, path: (id: string) => `/conversations/${id}/stop`},
    {method: 'POST' as const, path: (id: string) => `/conversations/${id}/retry`},
  ])('$method $path access', ({method, path, payload}) => {
    it('returns 404 to a workspace admin who is not the owner', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const admin = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });

      const res = await app.inject({
        method,
        url: path(conversation.id),
        headers: {authorization: admin.authorization},
        ...(payload ? {payload} : {}),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('conversation-not-found');
    });

    it('returns the same 404 for a conversation that does not exist', async () => {
      const caller = member({workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method,
        url: path(crypto.randomUUID()),
        headers: {authorization: caller.authorization},
        ...(payload ? {payload} : {}),
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('conversation-not-found');
    });

    it('returns 404 for a conversation of another origin, even to its would-be owner', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const caller = member({workspaceId});
      const rows = await db()
        .insert(conversations)
        .values({workspaceId, projectId, agentKey: 'shippy', originKind: 'integration'})
        .returning({id: conversations.id});

      const res = await app.inject({
        method,
        url: path(rows[0]?.id as string),
        headers: {authorization: caller.authorization},
        ...(payload ? {payload} : {}),
      });

      expect(res.statusCode).toBe(404);
    });

    it('refuses an owner who left the workspace', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      users.set(owner.authorization, {userId: owner.userId, memberships: []});

      const res = await app.inject({
        method,
        url: path(conversation.id),
        headers: {authorization: owner.authorization},
        ...(payload ? {payload} : {}),
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /conversations/:conversationId', () => {
    it('returns the header with no active turn', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
        body: 'First question',
      });

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversation.id}`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: conversation.id,
        title: 'First question',
        last_seq: 0,
        active_turn: null,
        latest_turn: null,
      });
    });

    it('returns the running turn', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      const turn = await turnFactory.create({conversationId: conversation.id});

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversation.id}`,
        headers: {authorization: owner.authorization},
      });

      expect(res.json().active_turn).toMatchObject({id: turn.id, status: 'running'});
      expect(res.json().latest_turn).toMatchObject({id: turn.id, status: 'running'});
    });

    it('returns the latest finished turn with its failure', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      await turnFactory.create({
        conversationId: conversation.id,
        status: 'succeeded',
        startedAt: new Date('2026-11-01T10:00:00Z'),
        finishedAt: new Date('2026-11-01T10:01:00Z'),
      });
      const failed = await turnFactory.create({
        conversationId: conversation.id,
        status: 'failed',
        failureCode: 'model_unavailable',
        model: 'claude-opus-5-5',
        provider: 'anthropic',
        startedAt: new Date('2026-11-01T11:00:00Z'),
        finishedAt: new Date('2026-11-01T11:00:05Z'),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversation.id}`,
        headers: {authorization: owner.authorization},
      });

      expect(res.json()).toMatchObject({
        active_turn: null,
        latest_turn: {
          id: failed.id,
          status: 'failed',
          failure_code: 'model_unavailable',
          model: 'claude-opus-5-5',
          provider: 'anthropic',
          finished_at: '2026-11-01T11:00:05.000Z',
        },
      });
    });
  });

  describe('GET /conversations/:conversationId/items', () => {
    async function arrangeClaimedConversation(params: {count: number}) {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
        body: 'message 1',
      });
      for (let index = 2; index <= params.count; index += 1) {
        await app.inject({
          method: 'POST',
          url: `/conversations/${conversation.id}/messages`,
          headers: {authorization: owner.authorization},
          payload: message({body: `message ${index}`}),
        });
      }
      await claimQueuedConversationItems(conversation.id);
      return {owner, conversationId: conversation.id};
    }

    function seqs(res: {json: () => {items: Array<{seq: number}>}}) {
      return res.json().items.map((item) => item.seq);
    }

    it('opens at the latest page, in ascending order', async () => {
      const {owner, conversationId} = await arrangeClaimedConversation({count: 5});

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items?limit=2`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(200);
      expect(seqs(res)).toEqual([4, 5]);
      expect(res.json().has_more).toBe(true);
    });

    it('reads forward after a seq', async () => {
      const {owner, conversationId} = await arrangeClaimedConversation({count: 5});

      const first = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items?after_seq=1&limit=2`,
        headers: {authorization: owner.authorization},
      });
      const last = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items?after_seq=3&limit=2`,
        headers: {authorization: owner.authorization},
      });

      expect(seqs(first)).toEqual([2, 3]);
      expect(first.json().has_more).toBe(true);
      expect(seqs(last)).toEqual([4, 5]);
      expect(last.json().has_more).toBe(false);
    });

    it('reads backward before a seq, in ascending order', async () => {
      const {owner, conversationId} = await arrangeClaimedConversation({count: 5});

      const page = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items?before_seq=5&limit=2`,
        headers: {authorization: owner.authorization},
      });
      const oldest = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items?before_seq=3&limit=2`,
        headers: {authorization: owner.authorization},
      });

      expect(seqs(page)).toEqual([3, 4]);
      expect(page.json().has_more).toBe(true);
      expect(seqs(oldest)).toEqual([1, 2]);
      expect(oldest.json().has_more).toBe(false);
    });

    it('returns queued inputs apart from claimed items', async () => {
      const {owner, conversationId} = await arrangeClaimedConversation({count: 1});
      await app.inject({
        method: 'POST',
        url: `/conversations/${conversationId}/messages`,
        headers: {authorization: owner.authorization},
        payload: message({body: 'queued'}),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items`,
        headers: {authorization: owner.authorization},
      });

      expect(seqs(res)).toEqual([1]);
      expect(res.json().queued).toMatchObject([{seq: null, content: {rows: [{text: 'queued'}]}}]);
    });

    it('returns every queued input, whatever the page limit', async () => {
      const {owner, conversationId} = await arrangeClaimedConversation({count: 1});
      for (let index = 0; index < 5; index += 1) {
        await app.inject({
          method: 'POST',
          url: `/conversations/${conversationId}/messages`,
          headers: {authorization: owner.authorization},
          payload: message({body: `queued ${index}`}),
        });
      }

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items?limit=2`,
        headers: {authorization: owner.authorization},
      });

      expect(res.json().queued).toHaveLength(5);
      expect(res.json().queued_has_more).toBe(false);
    });

    it('returns an unreadable item with a null body', async () => {
      const {owner, conversationId} = await arrangeClaimedConversation({count: 2});
      await db()
        .update(conversationItems)
        .set({body: Buffer.from('not sealed')})
        .where(
          and(eq(conversationItems.conversationId, conversationId), eq(conversationItems.seq, 1)),
        );

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().items).toMatchObject([
        {seq: 1, content: null},
        {seq: 2, content: {rows: [{text: 'message 2'}]}},
      ]);
    });

    it.each(['after_seq', 'before_seq'])('rejects a %s past int4', async (field) => {
      const {owner, conversationId} = await arrangeClaimedConversation({count: 1});

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items?${field}=2147483648`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(400);
    });

    describe('what a client sees', () => {
      async function arrangeEntry(entry: string | Record<string, unknown>, meta?: {role: string}) {
        const {workspaceId, projectId} = arrangeProject();
        const owner = member({workspaceId});
        const {conversation} = await conversationFactory.create({
          workspaceId,
          projectId,
          ownerUserId: owner.userId,
        });
        await claimQueuedConversationItems(conversation.id);
        await appendConversationEntry({conversation, entry, ...(meta ? {meta} : {})});
        const res = await app.inject({
          method: 'GET',
          url: `/conversations/${conversation.id}/items`,
          headers: {authorization: owner.authorization},
        });
        return {res, last: res.json().items.at(-1)};
      }

      it('drops the pinned system entry', async () => {
        const {res} = await arrangeEntry(
          {
            type: 'message',
            timestamp: '2026-11-02T00:00:00.000Z',
            message: {
              role: 'system',
              content: 'the-base-prompt',
              toolsAdded: [{name: 'the_tool_name', description: 'd', parameters: {}}],
            },
          },
          {role: 'system'},
        );

        expect(res.statusCode).toBe(200);
        expect(res.json().items).toHaveLength(1);
        expect(res.body).not.toContain('the-base-prompt');
        expect(res.body).not.toContain('the_tool_name');
      });

      it('keeps paging forward past the pinned system entry', async () => {
        const {workspaceId, projectId} = arrangeProject();
        const owner = member({workspaceId});
        const {conversation} = await conversationFactory.create({
          workspaceId,
          projectId,
          ownerUserId: owner.userId,
          body: 'First question',
        });
        await appendConversationEntry({
          conversation,
          entry: {type: 'message', message: {role: 'system', content: 'the-base-prompt'}},
          meta: {role: 'system'},
        });
        await claimQueuedConversationItems(conversation.id);

        const res = await app.inject({
          method: 'GET',
          url: `/conversations/${conversation.id}/items?after_seq=0&limit=1`,
          headers: {authorization: owner.authorization},
        });

        expect(res.json().items).toMatchObject([
          {seq: 2, content: {rows: [{text: 'First question'}]}},
        ]);
        expect(res.json().has_more).toBe(false);
      });

      it('leaves out a system entry that cannot be opened', async () => {
        const {workspaceId, projectId} = arrangeProject();
        const owner = member({workspaceId});
        const {conversation} = await conversationFactory.create({
          workspaceId,
          projectId,
          ownerUserId: owner.userId,
        });
        const systemItemId = await appendConversationEntry({
          conversation,
          entry: {type: 'message', message: {role: 'system', content: 'the-base-prompt'}},
          meta: {role: 'system'},
        });
        await db()
          .update(conversationItems)
          .set({body: Buffer.from('not sealed')})
          .where(eq(conversationItems.id, systemItemId));

        const res = await app.inject({
          method: 'GET',
          url: `/conversations/${conversation.id}/items`,
          headers: {authorization: owner.authorization},
        });

        expect(res.json().items).toEqual([]);
      });

      it('keeps a block type it does not know away from the fallback', async () => {
        const {res} = await arrangeEntry({
          type: 'message',
          timestamp: '2026-11-02T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [{type: 'encrypted_reasoning', payload: 'secret-payload'}],
          },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain('secret-payload');
      });

      it.each([
        'constructor',
        'toString',
        '__proto__',
      ])('hides a block whose type is %s', async (type) => {
        const {res} = await arrangeEntry({
          type: 'message',
          timestamp: '2026-11-02T00:00:00.000Z',
          message: {role: 'assistant', content: [{type, payload: 'secret-payload'}]},
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain('secret-payload');
      });

      it('shows a tool argument named signature', async () => {
        const {last} = await arrangeEntry({
          type: 'message',
          timestamp: '2026-11-02T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {type: 'toolCall', id: 'c', name: 'read', arguments: {signature: 'a-document-field'}},
            ],
          },
        });

        expect(last.content.rows[0].input).toContain('a-document-field');
      });

      it('removes the page note from a user message', async () => {
        const {workspaceId, projectId} = arrangeProject();
        const owner = member({workspaceId});
        const {conversation} = await conversationFactory.create({
          workspaceId,
          projectId,
          ownerUserId: owner.userId,
          body: 'Why did this fail?',
          pageContext: {page: 'run', run_id: crypto.randomUUID(), attempt: 2},
        });
        await claimQueuedConversationItems(conversation.id);

        const res = await app.inject({
          method: 'GET',
          url: `/conversations/${conversation.id}/items`,
          headers: {authorization: owner.authorization},
        });

        expect(res.json().items[0].content.rows).toMatchObject([{text: 'Why did this fail?'}]);
        expect(res.body).not.toContain('page_context');
      });

      it('returns thinking and text, with no signature', async () => {
        const {res, last} = await arrangeEntry({
          type: 'message',
          timestamp: '2026-11-02T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {type: 'thinking', thinking: 'Reasoning', thinkingSignature: 'secret-signature'},
              {type: 'text', text: 'Answer', textSignature: 'secret-signature'},
              {
                type: 'toolCall',
                id: 'c',
                name: 'read',
                arguments: {},
                thoughtSignature: 'secret-signature',
              },
            ],
          },
        });

        expect(last.content.rows.map((row: {kind: string}) => row.kind)).toEqual(
          expect.arrayContaining(['thinking', 'message', 'tool-call']),
        );
        expect(res.body).not.toContain('secret-signature');
      });

      it('keeps a signature out of the fallback for a reply with nothing to show', async () => {
        const {res} = await arrangeEntry({
          type: 'message',
          timestamp: '2026-11-02T00:00:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'thinking',
                thinking: '',
                thinkingSignature: 'secret-signature',
                redacted: true,
              },
            ],
          },
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain('secret-signature');
      });

      it('keeps the system prompt out of a compaction with no summary', async () => {
        const {res} = await arrangeEntry({
          type: 'compaction',
          timestamp: '2026-11-02T00:00:00.000Z',
          firstKeptEntryId: 'a',
          tokensBefore: 10,
          systemMessage: {role: 'system', content: 'the-base-prompt'},
        });

        expect(res.statusCode).toBe(200);
        expect(res.body).not.toContain('the-base-prompt');
      });

      it('returns an unknown entry as a raw row with no content', async () => {
        const {res, last} = await arrangeEntry({
          type: 'future_entry',
          timestamp: '2026-11-02T00:00:00.000Z',
          thinkingSignature: 'secret-signature',
        });

        expect(last.entry_type).toBe('future_entry');
        expect(last.content.rows).toMatchObject([{kind: 'raw', raw: ''}]);
        expect(res.body).not.toContain('secret-signature');
      });

      it('returns a malformed entry as a raw row with no content', async () => {
        const {last} = await arrangeEntry('{not json secret-signature');

        expect(last.content.rows).toMatchObject([{kind: 'raw', raw: ''}]);
      });

      it('returns a run result through its own DTO', async () => {
        const details = {
          workflow_run_id: crypto.randomUUID(),
          run_attempt_id: crypto.randomUUID(),
          status: 'succeeded',
          job_keys: ['build'],
          outputs: {pr_url: 'https://example.com/1'},
        };

        const {last} = await arrangeEntry({
          type: 'custom_message',
          customType: 'run_result',
          timestamp: '2026-11-02T00:00:00.000Z',
          content: '<untrusted>result</untrusted>',
          display: true,
          details,
        });

        expect(last.content).toEqual({type: 'run_result', run_result: details});
      });

      it('returns a turn notice through its own DTO', async () => {
        const data = {
          code: 'admission-denied',
          message: null,
          required_action: {reason: 'depleted', message: 'Add credits', url: '/billing'},
        };

        const {last} = await arrangeEntry({
          type: 'custom',
          customType: 'turn_notice',
          timestamp: '2026-11-02T00:00:00.000Z',
          data,
        });

        expect(last.content).toEqual({type: 'turn_notice', turn_notice: data});
      });

      it('falls back to rows for a notice it cannot read', async () => {
        const {last} = await arrangeEntry({
          type: 'custom',
          customType: 'turn_notice',
          timestamp: '2026-11-02T00:00:00.000Z',
          data: {unexpected: true},
        });

        expect(last.content.type).toBe('rows');
      });
    });

    it('rejects both directions at once', async () => {
      const {owner, conversationId} = await arrangeClaimedConversation({count: 1});

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversationId}/items?after_seq=1&before_seq=2`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /conversations/:conversationId/messages', () => {
    it('wakes the conversation once the message is committed', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/messages`,
        headers: {authorization: owner.authorization},
        payload: message(),
      });

      expect(res.statusCode).toBe(201);
      expect(wake).toHaveBeenCalledExactlyOnceWith(conversation.id);
    });

    it('does not wake a conversation the caller does not own', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const other = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/messages`,
        headers: {authorization: other.authorization},
        payload: message(),
      });

      expect(res.statusCode).toBe(404);
      expect(wake).not.toHaveBeenCalled();
    });

    async function arrangeConversation() {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      return {owner, conversationId: conversation.id};
    }

    it('queues the message and stores its page context', async () => {
      const {owner, conversationId} = await arrangeConversation();
      const pageContext = {page: 'project_settings', section: 'general'};

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationId}/messages`,
        headers: {authorization: owner.authorization},
        payload: message({body: 'Next question', page_context: pageContext}),
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        seq: null,
        content: {rows: [{text: 'Next question'}]},
      });
    });

    it('returns the stored item for a repeated post', async () => {
      const {owner, conversationId} = await arrangeConversation();
      const payload = message();
      const post = () =>
        app.inject({
          method: 'POST',
          url: `/conversations/${conversationId}/messages`,
          headers: {authorization: owner.authorization},
          payload,
        });

      const first = await post();
      const repeat = await post();

      expect(repeat.statusCode).toBe(201);
      expect(repeat.json().id).toBe(first.json().id);
    });

    it('moves the conversation to the top of the list', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const scope = {workspaceId, projectId, ownerUserId: owner.userId};
      const older = await conversationFactory.create(scope);
      const newer = await conversationFactory.create(scope);

      await app.inject({
        method: 'POST',
        url: `/conversations/${older.conversation.id}/messages`,
        headers: {authorization: owner.authorization},
        payload: message(),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
      });
      expect(res.json().conversations.map((c: {id: string}) => c.id)).toEqual([
        older.conversation.id,
        newer.conversation.id,
      ]);
    });

    it.each([
      {name: 'an empty body', body: '   '},
      {name: 'a body over the limit', body: 'a'.repeat(CONVERSATION_MESSAGE_MAX_BYTES + 1)},
    ])('rejects $name', async ({body}) => {
      const {owner, conversationId} = await arrangeConversation();

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationId}/messages`,
        headers: {authorization: owner.authorization},
        payload: message({body}),
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejects a page context with an unknown field', async () => {
      const {owner, conversationId} = await arrangeConversation();

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversationId}/messages`,
        headers: {authorization: owner.authorization},
        payload: message({page_context: {page: 'runs', note: 'typed by a person'}}),
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /conversations/:conversationId/read', () => {
    async function arrangeUnreadConversation() {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      await db()
        .update(conversations)
        .set({lastSeq: 5, lastAgentSeq: 5})
        .where(eq(conversations.id, conversation.id));
      return {owner, conversationId: conversation.id};
    }

    async function markRead(params: {
      authorization: string;
      conversationId: string;
      lastReadSeq: number;
    }) {
      return await app.inject({
        method: 'POST',
        url: `/conversations/${params.conversationId}/read`,
        headers: {authorization: params.authorization},
        payload: {last_read_seq: params.lastReadSeq},
      });
    }

    async function readHeader(params: {authorization: string; conversationId: string}) {
      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${params.conversationId}`,
        headers: {authorization: params.authorization},
      });
      return res.json();
    }

    it('rejects a seq past int4', async () => {
      const {owner, conversationId} = await arrangeUnreadConversation();
      const {authorization} = owner;

      const res = await markRead({authorization, conversationId, lastReadSeq: 2147483648});

      expect(res.statusCode).toBe(400);
    });

    it('clears unread once the latest reply is read', async () => {
      const {owner, conversationId} = await arrangeUnreadConversation();
      const {authorization} = owner;

      const res = await markRead({authorization, conversationId, lastReadSeq: 5});

      expect(res.statusCode).toBe(204);
      expect(await readHeader({authorization, conversationId})).toMatchObject({
        unread: false,
        last_read_seq: 5,
      });
    });

    it('keeps a reply newer than the read position unread', async () => {
      const {owner, conversationId} = await arrangeUnreadConversation();
      const {authorization} = owner;

      await markRead({authorization, conversationId, lastReadSeq: 4});

      expect(await readHeader({authorization, conversationId})).toMatchObject({
        unread: true,
        last_read_seq: 4,
      });
    });

    it('never moves the read position backward', async () => {
      const {owner, conversationId} = await arrangeUnreadConversation();
      const {authorization} = owner;
      await markRead({authorization, conversationId, lastReadSeq: 4});

      await markRead({authorization, conversationId, lastReadSeq: 2});

      expect((await readHeader({authorization, conversationId})).last_read_seq).toBe(4);
    });

    it('never moves past the last seq', async () => {
      const {owner, conversationId} = await arrangeUnreadConversation();
      const {authorization} = owner;

      await markRead({authorization, conversationId, lastReadSeq: 99});

      expect((await readHeader({authorization, conversationId})).last_read_seq).toBe(5);
    });
  });

  describe('POST /conversations/:conversationId/stop', () => {
    it('asks the running turn to stop', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      const turn = await turnFactory.create({conversationId: conversation.id});

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/stop`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(204);
      expect((await getRunningTurn(conversation.id))?.stopRequestedAt).toBeInstanceOf(Date);
      expect((await getRunningTurn(conversation.id))?.id).toBe(turn.id);
    });

    it('does nothing when no turn is running', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      const finished = await turnFactory.create({
        conversationId: conversation.id,
        status: 'succeeded',
      });

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/stop`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(204);
      expect(await getTurnById(finished.id)).toMatchObject({stopRequestedAt: null});
    });
  });

  describe('POST /conversations/:conversationId/retry', () => {
    async function arrangeConversation(status: 'running' | 'succeeded' | 'failed' | 'stopped') {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      await turnFactory.create({conversationId: conversation.id, status});
      return {owner, conversation};
    }

    function retry(params: {conversationId: string; authorization: string}) {
      return app.inject({
        method: 'POST',
        url: `/conversations/${params.conversationId}/retry`,
        headers: {authorization: params.authorization},
      });
    }

    it('requests a retry of a failed turn and wakes the conversation', async () => {
      const {owner, conversation} = await arrangeConversation('failed');

      const res = await retry({
        conversationId: conversation.id,
        authorization: owner.authorization,
      });

      expect(res.statusCode).toBe(204);
      const [row] = await db()
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversation.id));
      expect(row?.retryRequestedAt).toBeInstanceOf(Date);
      expect(wake).toHaveBeenCalledWith(conversation.id);
    });

    it.each(['succeeded', 'stopped'] as const)('refuses after a %s turn', async (status) => {
      const {owner, conversation} = await arrangeConversation(status);

      const res = await retry({
        conversationId: conversation.id,
        authorization: owner.authorization,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('conversation-retry-unavailable');
      expect(wake).not.toHaveBeenCalled();
    });

    it('refuses during a running turn', async () => {
      const {owner, conversation} = await arrangeConversation('running');

      const res = await retry({
        conversationId: conversation.id,
        authorization: owner.authorization,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('conversation-turn-running');
    });
  });

  describe('DELETE /conversations/:conversationId', () => {
    it('deletes the conversation', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/conversations/${conversation.id}`,
        headers: {authorization: owner.authorization},
      });

      const after = await app.inject({
        method: 'GET',
        url: `/conversations/${conversation.id}`,
        headers: {authorization: owner.authorization},
      });
      expect(res.statusCode).toBe(204);
      expect(after.statusCode).toBe(404);
    });

    it('refuses during a running turn', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
      });
      await turnFactory.create({conversationId: conversation.id});

      const res = await app.inject({
        method: 'DELETE',
        url: `/conversations/${conversation.id}`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('conversation-turn-running');
      expect(await getRunningTurn(conversation.id)).toBeDefined();
    });
  });

  it('omits the routes without a projects client', () => {
    const groups = createAgentRoutes(undefined as never);

    expect(groups.some((group) => group.prefix === '/conversations')).toBe(false);
  });

  it('omits the routes without a wake handler, so no message is accepted that nothing would run', () => {
    const groups = createAgentRoutes(undefined as never, {
      projects: createTestProjectsClient({projects}),
    });

    expect(groups.some((group) => group.prefix === '/conversations')).toBe(false);
  });
});
