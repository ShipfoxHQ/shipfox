import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {JamCredentialStore} from '#core/credentials.js';
import {
  JamInvalidTokenError,
  JamMcpUnavailableError,
  JamMissingReadScopeError,
  JamTokenPrefixError,
} from '#core/errors.js';
import type {ValidatedJamToken} from '#core/validate-token.js';
import {
  createJamInstallation,
  deleteJamInstallationByConnectionId,
  getJamInstallationByConnectionId,
  type JamInstallation,
} from '#db/installations.js';
import {JAM_TEAM_ID, jamConnection, jamCredentials} from '#test/fixtures/jam.js';
import {createJamConnectionRoutes} from './connections.js';

const workspaceId = jamConnection().workspaceId;

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: [{workspaceId, role: 'admin', workspaceStatus: 'active'}],
      }),
    );
    return Promise.resolve();
  },
};

const validated: ValidatedJamToken = {
  teamId: JAM_TEAM_ID,
  userId: 'user-2',
  userName: 'Grace',
  userEmail: 'grace@example.com',
};

interface CreateTestAppOptions {
  validateToken?: (token: string) => Promise<ValidatedJamToken>;
  credentials?: JamCredentialStore;
  existing?: IntegrationConnection<'jam'>;
  connection?: IntegrationConnection<'jam'>;
  getConnection?: (connectionId: string) => Promise<IntegrationConnection<'jam'> | undefined>;
  updateConnection?: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'jam'> | undefined>;
}

async function createTestApp(options: CreateTestAppOptions = {}) {
  const currentConnection = options.connection ?? jamConnection();
  return await createApp({
    auth: [fakeUserAuth],
    routes: [
      createJamConnectionRoutes({
        validateToken: options.validateToken ?? (async () => validated),
        credentials: options.credentials ?? jamCredentials(null),
        getExistingConnection: async () => options.existing,
        createConnection: async () => currentConnection,
        getConnection: options.getConnection ?? (async () => currentConnection),
        updateConnection: options.updateConnection ?? (async () => currentConnection),
      }),
    ],
    swagger: false,
  });
}

const seededInstallationIds = new Set<string>();

async function seedInstallation(connectionId: string): Promise<JamInstallation> {
  const installation = await createJamInstallation({
    connectionId,
    teamId: JAM_TEAM_ID,
    userId: 'user-1',
    userName: 'Ada',
    userEmail: 'ada@example.com',
    token: 'jam_pat_old1',
  });
  seededInstallationIds.add(connectionId);
  return installation;
}

describe('Jam connection routes', () => {
  afterEach(async () => {
    await closeApp();
    for (const connectionId of seededInstallationIds) {
      await deleteJamInstallationByConnectionId(connectionId);
    }
    seededInstallationIds.clear();
  });

  it('connects a Jam workspace and returns a connection DTO', async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/jam/connect',
      payload: {workspace_id: workspaceId, token: 'jam_pat_secret'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      connection: {provider: 'jam', slug: 'jam', display_name: 'Jam'},
    });
  });

  it('returns the existing connection id as a 409', async () => {
    const app = await createTestApp({existing: jamConnection()});

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/jam/connect',
      payload: {workspace_id: workspaceId, token: 'jam_pat_secret'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'already-connected',
      details: {connection_id: jamConnection().id},
    });
  });

  it.each([
    {error: new JamTokenPrefixError(), code: 'invalid-token-prefix'},
    {error: new JamInvalidTokenError(), code: 'invalid-token'},
    {error: new JamMissingReadScopeError(), code: 'missing-read-scope'},
    {error: new JamMcpUnavailableError('forbidden'), code: 'mcp-unavailable'},
  ])('returns $code with a 400 when validation fails', async ({error, code}) => {
    const app = await createTestApp({validateToken: () => Promise.reject(error)});

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/jam/connect',
      payload: {workspace_id: workspaceId, token: 'jam_pat_secret'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code});
  });

  it('returns the Jam user and token hint for a connection', async () => {
    const currentConnection = jamConnection({id: crypto.randomUUID()});
    await seedInstallation(currentConnection.id);
    const app = await createTestApp({connection: currentConnection});

    const response = await app.inject({
      method: 'GET',
      url: `/integrations/jam/connections/${currentConnection.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user_name: 'Ada',
      user_email: 'ada@example.com',
      token_hint: 'old1',
    });
  });

  it('returns 404 for connection details without an installation', async () => {
    const currentConnection = jamConnection({id: crypto.randomUUID()});
    const app = await createTestApp({connection: currentConnection});

    const response = await app.inject({
      method: 'GET',
      url: `/integrations/jam/connections/${currentConnection.id}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({code: 'not-found'});
  });

  it('rejects connection details in a workspace the user cannot access', async () => {
    const currentConnection = jamConnection({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
    });
    await seedInstallation(currentConnection.id);
    const app = await createTestApp({connection: currentConnection});

    const response = await app.inject({
      method: 'GET',
      url: `/integrations/jam/connections/${currentConnection.id}`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({code: 'forbidden'});
  });

  it('returns 404 when replacing a missing connection', async () => {
    const connectionId = crypto.randomUUID();
    const getConnection = vi.fn(async () => undefined);
    const app = await createTestApp({getConnection});

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/jam/connections/${connectionId}/token`,
      payload: {token: 'jam_pat_new'},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({code: 'not-found'});
  });

  it('rejects replacement for a connection in a workspace the user cannot access', async () => {
    const currentConnection = jamConnection({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
    });
    const app = await createTestApp({connection: currentConnection});

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/jam/connections/${currentConnection.id}/token`,
      payload: {token: 'jam_pat_new'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({code: 'forbidden'});
  });

  it('maps a token from another Jam workspace to workspace-mismatch', async () => {
    const currentConnection = jamConnection({id: crypto.randomUUID()});
    await seedInstallation(currentConnection.id);
    const credentials = jamCredentials();
    const app = await createTestApp({
      connection: currentConnection,
      credentials,
      validateToken: async () => ({...validated, teamId: 'another-team'}),
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/jam/connections/${currentConnection.id}/token`,
      payload: {token: 'jam_pat_new'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({code: 'workspace-mismatch'});
    expect(credentials.setToken).not.toHaveBeenCalled();
  });

  it('keeps the old token, user and status when the new token fails MCP access', async () => {
    const currentConnection = jamConnection({id: crypto.randomUUID(), lifecycleStatus: 'error'});
    await seedInstallation(currentConnection.id);
    const credentials = jamCredentials();
    const updateConnection = vi.fn();
    const app = await createTestApp({
      connection: currentConnection,
      credentials,
      updateConnection,
      validateToken: () => Promise.reject(new JamMcpUnavailableError('Insufficient scope')),
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/jam/connections/${currentConnection.id}/token`,
      payload: {token: 'jam_pat_new'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'mcp-unavailable'});
    expect(credentials.setToken).not.toHaveBeenCalled();
    expect(credentials.deleteToken).not.toHaveBeenCalled();
    expect(updateConnection).not.toHaveBeenCalled();
    expect(await getJamInstallationByConnectionId(currentConnection.id)).toMatchObject({
      credentialVersion: 1,
      userName: 'Ada',
      tokenHint: 'old1',
    });
    expect(currentConnection.lifecycleStatus).toBe('error');
  });

  it('restores the previous token when the metadata transaction fails', async () => {
    const currentConnection = jamConnection({id: crypto.randomUUID(), lifecycleStatus: 'error'});
    await seedInstallation(currentConnection.id);
    const credentials = jamCredentials('jam_pat_old_token');
    const app = await createTestApp({
      connection: currentConnection,
      credentials,
      updateConnection: vi.fn(() => Promise.reject(new Error('transaction failed'))),
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/jam/connections/${currentConnection.id}/token`,
      payload: {token: 'jam_pat_new_token'},
    });

    expect(response.statusCode).toBe(500);
    expect(credentials.setToken).toHaveBeenNthCalledWith(1, {
      connectionId: currentConnection.id,
      workspaceId,
      token: 'jam_pat_new_token',
    });
    expect(credentials.setToken).toHaveBeenNthCalledWith(2, {
      connectionId: currentConnection.id,
      workspaceId,
      token: 'jam_pat_old_token',
    });
    expect(await getJamInstallationByConnectionId(currentConnection.id)).toMatchObject({
      credentialVersion: 1,
      userName: 'Ada',
      tokenHint: 'old1',
    });
  });

  it('replaces the token, the user and the version, and activates the connection', async () => {
    const currentConnection = jamConnection({id: crypto.randomUUID()});
    await seedInstallation(currentConnection.id);
    const updateConnection = vi.fn(async () => currentConnection);
    const app = await createTestApp({connection: currentConnection, updateConnection});

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/jam/connections/${currentConnection.id}/token`,
      payload: {token: 'jam_pat_new_token'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({id: currentConnection.id, provider: 'jam'});
    expect(updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: currentConnection.id,
        lifecycleStatus: 'active',
        tx: expect.anything(),
      }),
    );
    expect(await getJamInstallationByConnectionId(currentConnection.id)).toMatchObject({
      credentialVersion: 2,
      tokenHint: 'oken',
      userId: 'user-2',
      userName: 'Grace',
      userEmail: 'grace@example.com',
    });
  });
});
