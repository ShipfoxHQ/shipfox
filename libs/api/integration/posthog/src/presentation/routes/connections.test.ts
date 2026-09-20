import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {PosthogApiClient, PosthogProject} from '#api/client.js';
import type {PosthogCredentialStore} from '#core/credentials.js';
import {
  createPosthogInstallation,
  deletePosthogInstallationByConnectionId,
  type PosthogInstallation,
} from '#db/installations.js';
import {createPosthogConnectionRoutes} from './connections.js';

const workspaceId = '00000000-0000-4000-8000-000000000001';

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

function project(overrides: Partial<PosthogProject> = {}): PosthogProject {
  return {id: 'project-1', name: 'Analytics', organizationId: 'organization-1', ...overrides};
}

function connection(
  overrides: Partial<IntegrationConnection<'posthog'>> = {},
): IntegrationConnection<'posthog'> {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    workspaceId: workspaceId,
    provider: 'posthog',
    externalAccountId: 'eu:project-1',
    slug: 'posthog_analytics',
    displayName: 'Analytics',
    lifecycleStatus: 'active',
    repositoryAccessMode: 'selected',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function installation(overrides: Partial<PosthogInstallation> = {}): PosthogInstallation {
  return {
    connectionId: connection().id,
    region: 'eu',
    projectId: 'project-1',
    projectName: 'Analytics',
    organizationId: 'organization-1',
    keyHint: 'old1',
    credentialVersion: 1,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

function credentials(): PosthogCredentialStore {
  return {
    getApiKey: vi.fn(() => Promise.resolve(null)),
    setApiKey: vi.fn(() => Promise.resolve()),
    deleteApiKey: vi.fn(() => Promise.resolve(1)),
  };
}

function api(projects: PosthogProject[]): PosthogApiClient {
  return {
    listProjects: vi.fn(() => Promise.resolve(projects)),
    validateQuery: vi.fn(() => Promise.resolve()),
    probeCredential: vi.fn(() => Promise.resolve()),
  };
}

interface CreateTestAppOptions {
  posthog?: PosthogApiClient;
  existing?: IntegrationConnection<'posthog'>;
  connection?: IntegrationConnection<'posthog'>;
  getConnection?: (connectionId: string) => Promise<IntegrationConnection<'posthog'> | undefined>;
  getInstallation?: (connectionId: string) => Promise<PosthogInstallation | undefined>;
  updateConnection?: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'posthog'> | undefined>;
}

async function createTestApp(options: CreateTestAppOptions = {}) {
  const currentConnection = options.connection ?? connection();
  return await createApp({
    auth: [fakeUserAuth],
    routes: [
      createPosthogConnectionRoutes({
        posthog: options.posthog ?? api([project()]),
        credentials: credentials(),
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

async function seedInstallation(value: PosthogInstallation): Promise<void> {
  await createPosthogInstallation(value);
  seededInstallationIds.add(value.connectionId);
}

describe('PostHog connection routes', () => {
  afterEach(async () => {
    await closeApp();
    for (const connectionId of seededInstallationIds) {
      await deletePosthogInstallationByConnectionId(connectionId);
    }
    seededInstallationIds.clear();
  });

  it('auto-connects one project and returns a connection DTO', async () => {
    const app = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/integrations/posthog/connect',
      payload: {workspace_id: workspaceId, region: 'eu', api_key: 'phx_secret'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({status: 'connected', connection: {provider: 'posthog'}});
  });

  it('returns the picker response without creating a connection', async () => {
    const projects = [project(), project({id: 'project-2', name: 'Billing'})];
    const posthog = api(projects);
    const createConnection = vi.fn(() => Promise.resolve(connection()));
    const app = await createApp({
      auth: [fakeUserAuth],
      routes: [
        createPosthogConnectionRoutes({
          posthog,
          credentials: credentials(),
          getExistingConnection: async () => undefined,
          createConnection,
          getConnection: async () => connection(),
          updateConnection: async () => connection(),
        }),
      ],
      swagger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/posthog/connect',
      payload: {workspace_id: workspaceId, region: 'us', api_key: 'phx_secret'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'select-project',
      projects: [
        {id: 'project-1', name: 'Analytics'},
        {id: 'project-2', name: 'Billing'},
      ],
    });
    expect(createConnection).not.toHaveBeenCalled();
  });

  it('returns the existing connection id as a 409', async () => {
    const app = await createTestApp({existing: connection()});

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/posthog/connect',
      payload: {workspace_id: workspaceId, region: 'eu', api_key: 'phx_secret'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 'already-connected',
      details: {connection_id: connection().id},
    });
  });

  it('rejects public project keys clearly', async () => {
    const app = await createTestApp();

    const response = await app.inject({
      method: 'POST',
      url: '/integrations/posthog/connect',
      payload: {workspace_id: workspaceId, region: 'eu', api_key: 'phc_public'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'invalid-api-key-prefix'});
  });

  it('returns 404 when replacing a missing connection', async () => {
    const connectionId = crypto.randomUUID();
    const getConnection = vi.fn(async () => undefined);
    const app = await createTestApp({getConnection});

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/posthog/connections/${connectionId}/api-key`,
      payload: {api_key: 'phx_new_key'},
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
      url: `/integrations/posthog/connections/${currentConnection.id}/api-key`,
      payload: {api_key: 'phx_new_key'},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({code: 'forbidden'});
  });

  it('maps a replacement project mismatch to a client error', async () => {
    const currentConnection = connection({id: crypto.randomUUID()});
    const currentInstallation = installation({connectionId: currentConnection.id});
    const app = await createTestApp({
      connection: currentConnection,
      posthog: api([project({id: 'project-2', name: 'Billing'})]),
      getInstallation: async () => currentInstallation,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/posthog/connections/${currentConnection.id}/api-key`,
      payload: {api_key: 'phx_new_key'},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'project-mismatch'});
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
      url: `/integrations/posthog/connections/${currentConnection.id}/api-key`,
      payload: {api_key: 'phx_new_key'},
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({code: 'credential-version-conflict'});
  });

  it('returns the updated connection DTO after replacing the API key', async () => {
    const currentConnection = connection({id: crypto.randomUUID()});
    const currentInstallation = installation({connectionId: currentConnection.id});
    await seedInstallation(currentInstallation);
    const updateConnection = vi.fn(async () => currentConnection);
    const app = await createTestApp({
      connection: currentConnection,
      getInstallation: async () => currentInstallation,
      updateConnection,
    });

    const response = await app.inject({
      method: 'PUT',
      url: `/integrations/posthog/connections/${currentConnection.id}/api-key`,
      payload: {api_key: 'phx_new_key'},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: currentConnection.id,
      workspace_id: workspaceId,
      provider: 'posthog',
      external_account_id: 'eu:project-1',
      lifecycle_status: 'active',
    });
    expect(updateConnection).toHaveBeenCalledWith(
      expect.objectContaining({id: currentConnection.id, lifecycleStatus: 'active'}),
    );
  });
});
