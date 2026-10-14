import {
  AUTH_AGENT_ACCESS,
  AUTH_AGENT_LOG_DOWNLOAD,
  getAgentAccessContext,
  getAgentLogDownloadContext,
} from '@shipfox/api-auth-context';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {createApp, defineRoute, type FastifyInstance} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import {issueAgentAccessToken} from '#core/agent-access-token.js';
import {mintAgentLogDownloadToken} from '#core/agent-log-download-token.js';
import {createAdminGrant} from '#db/admin-grants.js';
import {createAgentClient, createAgentGrant} from '#db/agent-access.js';
import {db} from '#db/db.js';
import {agentGrants} from '#db/schema/agent-access.js';
import {impersonationWindowFactory, userFactory} from '#test/index.js';
import {createAgentAccessAuthMethod} from './agent-access-auth.js';
import {createAgentLogDownloadAuthMethod} from './agent-log-download-auth.js';

function createWorkspaces(params: {
  userId: string;
  workspaceId: string;
  outage?: boolean;
}): WorkspacesInterModuleClient {
  return {
    listMembershipsForTokenClaims: () =>
      params.outage
        ? Promise.reject(new Error('workspaces unavailable'))
        : Promise.resolve({
            memberships: [
              {
                workspaceId: params.workspaceId,
                workspaceSlug: 'acme',
                role: 'admin',
                workspaceStatus: 'active',
              },
            ],
          }),
    requireActiveMembership: () =>
      params.outage ? Promise.reject(new Error('workspaces unavailable')) : Promise.resolve({}),
    getWorkspaceCreator: async () => ({creatorUserId: null}),
    getWorkspaceOperatingState: async () => ({status: 'active'}),
    getWorkspaceSummary: async () => undefined,
    preflightInvitationAcceptance: async () => ({}),
    acceptInvitation: async () => ({
      membership: {id: crypto.randomUUID(), userId: params.userId, workspaceId: params.workspaceId},
    }),
  };
}

async function createCredential(outage = false) {
  const user = await userFactory.create();
  const workspaceId = crypto.randomUUID();
  const client = await createAgentClient({
    clientId: `https://client.example.test/${crypto.randomUUID()}`,
    name: 'Test client',
    redirectUris: ['https://client.example.test/callback'],
    kind: 'registered',
  });
  const grant = await createAgentGrant({
    userId: user.id,
    workspaceId,
    clientId: client.id,
  });
  const minted = await mintAgentLogDownloadToken({
    sub: user.id,
    workspaceId,
    grantId: grant.id,
    clientId: client.clientId,
    streamId: crypto.randomUUID(),
  });
  return {
    token: minted.token,
    grantId: grant.id,
    workspaces: createWorkspaces({userId: user.id, workspaceId, outage}),
  };
}

async function createImpersonatedCredential(
  params: {
    role?: 'admin-observer' | 'admin-operator';
    windowWorkspaceId?: string;
    windowEndedAt?: Date;
    windowDeadlineAt?: Date;
    windowOwnedByAnotherAdministrator?: boolean;
  } = {},
) {
  const administrator = await userFactory.create();
  await createAdminGrant({userId: administrator.id, role: params.role ?? 'admin-operator'});
  const homeWorkspaceId = crypto.randomUUID();
  const customerWorkspaceId = crypto.randomUUID();
  const client = await createAgentClient({
    clientId: `https://client.example.test/${crypto.randomUUID()}`,
    name: 'Test client',
    redirectUris: ['https://client.example.test/callback'],
    kind: 'registered',
  });
  const grant = await createAgentGrant({
    userId: administrator.id,
    workspaceId: homeWorkspaceId,
    clientId: client.id,
  });
  const windowActorId = params.windowOwnedByAnotherAdministrator
    ? (await userFactory.create()).id
    : administrator.id;
  const window = await impersonationWindowFactory.create({
    actorId: windowActorId,
    workspaceId: params.windowWorkspaceId ?? customerWorkspaceId,
    ...(params.windowEndedAt ? {endedAt: params.windowEndedAt, endedReason: 'stopped'} : {}),
    ...(params.windowDeadlineAt
      ? {
          startedAt: new Date(params.windowDeadlineAt.getTime() - 30 * 60 * 1000),
          deadlineAt: params.windowDeadlineAt,
        }
      : {}),
  });
  const minted = await mintAgentLogDownloadToken({
    sub: administrator.id,
    workspaceId: customerWorkspaceId,
    grantId: grant.id,
    clientId: client.clientId,
    streamId: crypto.randomUUID(),
    impersonationWindowId: window.id,
  });
  return {
    token: minted.token,
    customerWorkspaceId,
    workspaces: createWorkspaces({userId: administrator.id, workspaceId: homeWorkspaceId}),
  };
}

function protectedRoutes() {
  return [
    defineRoute({
      method: 'GET',
      path: '/mcp',
      description: 'Test agent access boundary.',
      auth: AUTH_AGENT_ACCESS,
      handler: (request) => getAgentAccessContext(request),
    }),
    defineRoute({
      method: 'GET',
      path: '/step-log-downloads/current',
      description: 'Test agent log download boundary.',
      auth: AUTH_AGENT_LOG_DOWNLOAD,
      handler: (request) => getAgentLogDownloadContext(request),
    }),
  ];
}

async function openApp(workspaces: WorkspacesInterModuleClient): Promise<FastifyInstance> {
  return await createApp({
    auth: [createAgentAccessAuthMethod(), createAgentLogDownloadAuthMethod(workspaces)],
    routes: protectedRoutes(),
    swagger: false,
  });
}

describe('agent log download auth method', () => {
  test('checks authority before setting context', async () => {
    const credential = await createCredential();
    const app = await openApp(credential.workspaces);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/step-log-downloads/current',
        headers: {authorization: `Bearer ${credential.token}`},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({streamId: expect.any(String)}));
    } finally {
      await app.close();
    }
  });

  test('rejects a credential after its grant is revoked', async () => {
    const credential = await createCredential();
    await db()
      .update(agentGrants)
      .set({revokedAt: new Date()})
      .where(eq(agentGrants.id, credential.grantId));
    const app = await openApp(credential.workspaces);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/step-log-downloads/current',
        headers: {authorization: `Bearer ${credential.token}`},
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({code: 'unauthorized'});
    } finally {
      await app.close();
    }
  });

  test('rejects credentials at the opposite audience boundary', async () => {
    const credential = await createCredential();
    const app = await openApp(credential.workspaces);

    try {
      const downloadAsMcp = await app.inject({
        method: 'GET',
        url: '/mcp',
        headers: {authorization: `Bearer ${credential.token}`},
      });
      expect(downloadAsMcp.statusCode).toBe(401);

      const agentToken = await issueAgentAccessToken({
        sub: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        grantId: crypto.randomUUID(),
        clientId: 'client-id',
      });
      const agentAsDownload = await app.inject({
        method: 'GET',
        url: '/step-log-downloads/current',
        headers: {authorization: `Bearer ${agentToken}`},
      });
      expect(agentAsDownload.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  test('returns 503 when workspaces is unavailable', async () => {
    const credential = await createCredential(true);
    const app = await openApp(credential.workspaces);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/step-log-downloads/current',
        headers: {authorization: `Bearer ${credential.token}`},
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({code: 'auth-dependency-unavailable'});
    } finally {
      await app.close();
    }
  });

  describe('through an impersonation window', () => {
    test('accepts an administrator who is not a member of the workspace', async () => {
      const credential = await createImpersonatedCredential();
      const app = await openApp(credential.workspaces);

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/step-log-downloads/current',
          headers: {authorization: `Bearer ${credential.token}`},
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(
          expect.objectContaining({workspaceId: credential.customerWorkspaceId}),
        );
      } finally {
        await app.close();
      }
    });

    test.each([
      {name: 'the window has ended', params: {windowEndedAt: new Date()}},
      {
        name: 'the window has passed its deadline',
        params: {windowDeadlineAt: new Date(Date.now() - 60 * 1000)},
      },
      {
        name: 'the window belongs to another administrator',
        params: {windowOwnedByAnotherAdministrator: true},
      },
      {
        name: 'the window is on another workspace',
        params: {windowWorkspaceId: crypto.randomUUID()},
      },
      {name: 'the administrator lost the operator role', params: {role: 'admin-observer' as const}},
    ])('rejects the credential when $name', async ({params}) => {
      const credential = await createImpersonatedCredential(params);
      const app = await openApp(credential.workspaces);

      try {
        const response = await app.inject({
          method: 'GET',
          url: '/step-log-downloads/current',
          headers: {authorization: `Bearer ${credential.token}`},
        });

        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({code: 'unauthorized'});
      } finally {
        await app.close();
      }
    });
  });
});
