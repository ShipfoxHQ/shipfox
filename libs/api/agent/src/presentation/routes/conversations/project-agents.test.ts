import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {conversationFactory} from '#test/factories/conversation.js';
import {
  createTestDefinitionsClient,
  projectAgentSnapshot,
} from '#test/fixtures/definitions-client.js';
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

function member(params: {workspaceId: string; userId?: string}) {
  const user: TestUser = {
    userId: params.userId ?? crypto.randomUUID(),
    memberships: [{workspaceId: params.workspaceId, role: 'admin', workspaceStatus: 'active'}],
  };
  const authorization = `Bearer ${user.userId}`;
  users.set(authorization, user);
  return {...user, authorization};
}

describe('project agent routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  const projects = new Map<string, {workspaceId: string}>();
  const definitions = createTestDefinitionsClient();
  const wake = vi.fn<(conversationId: string) => Promise<void>>();

  function arrangeProject() {
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    projects.set(projectId, {workspaceId});
    return {workspaceId, projectId};
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
        definitions: definitions.client,
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

  describe('GET /projects/:projectId/agents', () => {
    it('lists only the built-in agent for a project without agent files', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/agents`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        agents: [{key: 'shippy', name: 'Shippy', description: null, error: null}],
      });
    });

    it('lists the built-in agent first, then the custom agents with their errors', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      definitions.agents.set(projectId, [
        projectAgentSnapshot({
          key: 'reviewer',
          name: 'Reviewer',
          description: 'Reviews pull requests.',
          instructions: 'Review.',
        }),
        projectAgentSnapshot({
          key: 'shippy',
          instructions: 'Use pnpm.',
          lastError: {message: 'Line 3 is invalid.', diagnostics: []},
        }),
        projectAgentSnapshot({key: 'triage', instructions: 'Triage.'}),
      ]);

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/agents`,
        headers: {authorization: owner.authorization},
      });

      expect(res.json()).toEqual({
        agents: [
          {
            key: 'shippy',
            name: 'Shippy',
            description: null,
            error: {message: 'Line 3 is invalid.'},
          },
          {key: 'reviewer', name: 'Reviewer', description: 'Reviews pull requests.', error: null},
          {key: 'triage', name: null, description: null, error: null},
        ],
      });
    });

    it('answers 404 for a project that does not exist', async () => {
      const owner = member({workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${crypto.randomUUID()}/agents`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('project-not-found');
    });

    it('answers 403 for a member of another workspace', async () => {
      const {projectId} = arrangeProject();
      const outsider = member({workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'GET',
        url: `/projects/${projectId}/agents`,
        headers: {authorization: outsider.authorization},
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('POST /projects/:projectId/conversations with agent_key', () => {
    it('creates a conversation with a custom agent', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      definitions.agents.set(projectId, [
        projectAgentSnapshot({key: 'reviewer', instructions: 'Review.'}),
      ]);

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
        payload: message({agent_key: 'reviewer'}),
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().conversation.agent_key).toBe('reviewer');
    });

    it('creates a conversation with the built-in agent by default', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
        payload: message(),
      });

      expect(res.json().conversation.agent_key).toBe('shippy');
    });

    it('refuses an agent the project does not have', async () => {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});

      const res = await app.inject({
        method: 'POST',
        url: `/projects/${projectId}/conversations`,
        headers: {authorization: owner.authorization},
        payload: message({agent_key: 'reviewer'}),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('agent-not-found');
      expect(wake).not.toHaveBeenCalled();
    });
  });

  describe('a conversation whose custom agent was deleted', () => {
    async function arrangeDeletedAgentConversation() {
      const {workspaceId, projectId} = arrangeProject();
      const owner = member({workspaceId});
      const {conversation} = await conversationFactory.create({
        workspaceId,
        projectId,
        ownerUserId: owner.userId,
        agentKey: 'reviewer',
      });
      return {owner, conversation};
    }

    it('stays readable', async () => {
      const {owner, conversation} = await arrangeDeletedAgentConversation();

      const res = await app.inject({
        method: 'GET',
        url: `/conversations/${conversation.id}`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().agent_key).toBe('reviewer');
    });

    it('takes no new message', async () => {
      const {owner, conversation} = await arrangeDeletedAgentConversation();

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/messages`,
        headers: {authorization: owner.authorization},
        payload: message(),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('conversation-agent-unavailable');
      expect(wake).not.toHaveBeenCalled();
    });

    it('takes no retry', async () => {
      const {owner, conversation} = await arrangeDeletedAgentConversation();

      const res = await app.inject({
        method: 'POST',
        url: `/conversations/${conversation.id}/retry`,
        headers: {authorization: owner.authorization},
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('conversation-agent-unavailable');
    });
  });
});
