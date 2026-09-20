import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {type AuthMethod, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {PosthogApiClient, PosthogProject} from '#api/client.js';
import type {PosthogCredentialStore} from '#core/credentials.js';
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

function connection(): IntegrationConnection<'posthog'> {
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

async function createTestApp(
  options: {posthog?: PosthogApiClient; existing?: IntegrationConnection<'posthog'>} = {},
) {
  return await createApp({
    auth: [fakeUserAuth],
    routes: [
      createPosthogConnectionRoutes({
        posthog: options.posthog ?? api([project()]),
        credentials: credentials(),
        getExistingConnection: async () => options.existing,
        createConnection: async () => connection(),
        getConnection: async () => connection(),
        updateConnection: async () => connection(),
      }),
    ],
    swagger: false,
  });
}

describe('PostHog connection routes', () => {
  afterEach(async () => {
    await closeApp();
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
});
