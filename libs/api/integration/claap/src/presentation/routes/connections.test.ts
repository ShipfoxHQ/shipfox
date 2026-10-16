import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {ClaapCredentialStore} from '#core/credentials.js';
import {ClaapIntegrationProviderError, ClaapInvalidApiKeyError} from '#core/errors.js';
import type {ClaapWorkspace} from '#core/mcp-client.js';
import {
  type ClaapInstallation,
  createClaapInstallation,
  deleteClaapInstallationByConnectionId,
  getClaapInstallationByConnectionId,
} from '#db/installations.js';
import {createClaapConnectionRoutes} from './connections.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const claapWorkspace: ClaapWorkspace = {workspaceId: 'q2IqD9wUHb', name: 'Mercateam'};

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

function connection(
  overrides: Partial<IntegrationConnection<'claap'>> = {},
): IntegrationConnection<'claap'> {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    workspaceId,
    provider: 'claap',
    externalAccountId: claapWorkspace.workspaceId,
    slug: 'claap_mercateam',
    displayName: 'Claap Mercateam',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function installation(overrides: Partial<ClaapInstallation> = {}): ClaapInstallation {
  return {
    connectionId: connection().id,
    workspaceId: claapWorkspace.workspaceId,
    workspaceName: claapWorkspace.name,
    keyHint: 'old1',
    credentialVersion: 1,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function credentials(): ClaapCredentialStore {
  return {
    getApiKey: vi.fn(() => Promise.resolve(null)),
    setApiKey: vi.fn(() => Promise.resolve()),
    deleteApiKey: vi.fn(() => Promise.resolve(1)),
  };
}

interface CreateTestAppOptions {
  listClaapWorkspaces?: (apiKey: string) => Promise<ClaapWorkspace[]>;
  credentials?: ClaapCredentialStore;
  existing?: IntegrationConnection<'claap'>;
  connection?: IntegrationConnection<'claap'>;
  getConnection?: (connectionId: string) => Promise<IntegrationConnection<'claap'> | undefined>;
  getInstallation?: (connectionId: string) => Promise<ClaapInstallation | undefined>;
  updateConnection?: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'claap'> | undefined>;
}

async function createTestApp(options: CreateTestAppOptions = {}) {
  const currentConnection = options.connection ?? connection();
  return await createApp({
    auth: [fakeUserAuth],
    routes: [
      createClaapConnectionRoutes({
        listClaapWorkspaces: options.listClaapWorkspaces ?? (async () => [claapWorkspace]),
        credentials: options.credentials ?? credentials(),
        getExistingConnection: async () => options.existing,
        createConnection: async () => currentConnection,
        getConnection: options.getConnection ?? (async () => currentConnection),
        ...(options.getInstallation === undefined
          ? {}
          : {getInstallation: options.getInstallation}),
        updateConnection: options.updateConnection ?? (async () => currentConnection),
      }),
    ],
    swagger: false,
  });
}

const seededInstallationIds = new Set<string>();

async function seedInstallation(value: ClaapInstallation): Promise<void> {
  await createClaapInstallation(value);
  seededInstallationIds.add(value.connectionId);
}

describe('Claap connection routes', () => {
  afterEach(async () => {
    await closeApp();
    for (const connectionId of seededInstallationIds) {
      await deleteClaapInstallationByConnectionId(connectionId);
    }
    seededInstallationIds.clear();
  });

  it('connects the workspace of the key and returns a connection DTO', async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/claap/connect',
      payload: {workspace_id: workspaceId, api_key: 'cla_secret'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      connection: {provider: 'claap', external_account_id: 'q2IqD9wUHb'},
    });
  });

  it('returns the existing connection id as a 409', async () => {
    const app = await createTestApp({existing: connection()});

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/claap/connect',
      payload: {workspace_id: workspaceId, api_key: 'cla_secret'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'already-connected',
      details: {connection_id: connection().id},
    });
  });

  it('rejects a key without the cla_ prefix', async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/claap/connect',
      payload: {workspace_id: workspaceId, api_key: 'phx_other'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'invalid-api-key-prefix'});
  });

  it('rejects a key that Claap does not accept', async () => {
    const app = await createTestApp({
      listClaapWorkspaces: () => Promise.reject(new ClaapInvalidApiKeyError()),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/claap/connect',
      payload: {workspace_id: workspaceId, api_key: 'cla_revoked'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'invalid-api-key'});
  });

  it('rejects a key that does not belong to exactly one workspace', async () => {
    const app = await createTestApp({listClaapWorkspaces: async () => []});

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/claap/connect',
      payload: {workspace_id: workspaceId, api_key: 'cla_secret'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'unexpected-workspace-count'});
  });

  it('rejects a connect for a workspace the user cannot access', async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/claap/connect',
      payload: {workspace_id: crypto.randomUUID(), api_key: 'cla_secret'},
    });

    expect(response.statusCode).toBe(403);
  });

  it.each([
    {reason: 'rate-limited', status: 429},
    {reason: 'provider-unavailable', status: 503},
    {reason: 'malformed-provider-response', status: 422},
  ] as const)('returns the stable $reason code without provider text', async ({reason, status}) => {
    const app = await createTestApp({
      listClaapWorkspaces: () =>
        Promise.reject(new ClaapIntegrationProviderError(reason, 'private provider detail')),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/claap/connect',
      payload: {workspace_id: workspaceId, api_key: 'cla_key'},
    });

    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({code: reason, details: {}});
  });

  it('returns 404 when replacing a missing connection', async () => {
    const connectionId = crypto.randomUUID();
    const getConnection = vi.fn(async () => undefined);
    const app = await createTestApp({getConnection});

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/claap/connections/${connectionId}/api-key`,
      payload: {api_key: 'cla_new_key'},
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({code: 'not-found'});
    expect(getConnection).toHaveBeenCalledWith(connectionId);
  });

  it('rejects replacement for a connection in a workspace the user cannot access', async () => {
    const currentConnection = connection({
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
    });
    const app = await createTestApp({connection: currentConnection});

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/claap/connections/${currentConnection.id}/api-key`,
      payload: {api_key: 'cla_new_key'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({code: 'forbidden'});
  });

  it('maps a key for another Claap workspace to a 409 workspace-mismatch', async () => {
    const currentConnection = connection({id: crypto.randomUUID()});
    const currentInstallation = installation({connectionId: currentConnection.id});
    const credentialStore = credentials();
    const app = await createTestApp({
      connection: currentConnection,
      credentials: credentialStore,
      listClaapWorkspaces: async () => [{workspaceId: 'otherWorkspace', name: 'Other'}],
      getInstallation: async () => currentInstallation,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/claap/connections/${currentConnection.id}/api-key`,
      payload: {api_key: 'cla_new_key'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({code: 'workspace-mismatch'});
    expect(credentialStore.setApiKey).not.toHaveBeenCalled();
  });

  it('maps a replacement credential version conflict to a 409', async () => {
    const currentConnection = connection({id: crypto.randomUUID()});
    const currentInstallation = installation({
      connectionId: currentConnection.id,
      credentialVersion: 2,
    });
    await seedInstallation({...currentInstallation, credentialVersion: 1});
    const app = await createTestApp({
      connection: currentConnection,
      getInstallation: async () => currentInstallation,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/claap/connections/${currentConnection.id}/api-key`,
      payload: {api_key: 'cla_new_key'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({code: 'credential-version-conflict'});
  });

  it('returns the updated connection DTO after replacing the API key', async () => {
    const currentConnection = connection({id: crypto.randomUUID(), lifecycleStatus: 'error'});
    const currentInstallation = installation({connectionId: currentConnection.id});
    await seedInstallation(currentInstallation);
    const updateConnection = vi.fn(async () => ({
      ...currentConnection,
      lifecycleStatus: 'active' as const,
    }));
    const app = await createTestApp({
      connection: currentConnection,
      getInstallation: async () => currentInstallation,
      updateConnection,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/claap/connections/${currentConnection.id}/api-key`,
      payload: {api_key: 'cla_new_key'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: currentConnection.id,
      workspace_id: workspaceId,
      provider: 'claap',
      external_account_id: 'q2IqD9wUHb',
      lifecycle_status: 'active',
    });
    expect(updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: currentConnection.id,
        lifecycleStatus: 'active',
        tx: expect.anything(),
      }),
    );
    expect(await getClaapInstallationByConnectionId(currentConnection.id)).toMatchObject({
      credentialVersion: 2,
      keyHint: '_key',
    });
  });
});
