import {
  AUTH_AGENT_ACCESS,
  AUTH_AGENT_LOG_DOWNLOAD,
  getAgentAccessContext,
  getAgentLogDownloadContext,
} from '@shipfox/api-auth-context';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {createApp, defineRoute, type FastifyInstance} from '@shipfox/node-fastify';
import {issueAgentAccessToken} from '#core/agent-access-token.js';
import {mintAgentLogDownloadToken} from '#core/agent-log-download-token.js';
import {createAgentClient, createAgentGrant} from '#db/agent-access.js';
import {userFactory} from '#test/index.js';
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
              {workspaceId: params.workspaceId, role: 'admin', workspaceStatus: 'active'},
            ],
          }),
    requireActiveMembership: () =>
      params.outage ? Promise.reject(new Error('workspaces unavailable')) : Promise.resolve({}),
    getWorkspaceCreator: async () => ({creatorUserId: null}),
    getWorkspaceOperatingState: async () => ({status: 'active'}),
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
    scopes: ['read'],
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
    workspaces: createWorkspaces({userId: user.id, workspaceId, outage}),
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
        scopes: ['read'],
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
});
