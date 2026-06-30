import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {type AuthMethod, ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import type {CreateWebhookIntegrationProviderOptions} from '#index.js';
import {createWebhookIntegrationProvider} from '#index.js';

type CreateConnectionFn = CreateWebhookIntegrationProviderOptions['createIntegrationConnection'];
type ListConnectionsFn = CreateWebhookIntegrationProviderOptions['listIntegrationConnections'];
type GetConnectionFn = CreateWebhookIntegrationProviderOptions['getIntegrationConnectionById'];
type UpdateConnectionFn =
  CreateWebhookIntegrationProviderOptions['updateIntegrationConnectionLifecycleStatus'];
type DeleteConnectionFn = CreateWebhookIntegrationProviderOptions['deleteIntegrationConnection'];

const INBOUND_URL_RE = /^https:\/\/api\.example\.com\/webhook\//;

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(({workspaceId}) =>
    Promise.resolve({
      workspaceId,
      workspace: {
        id: workspaceId,
        name: 'Workspace',
        status: 'active',
        settings: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      userId: 'user-1',
      role: 'admin',
    }),
  ),
}));

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({userId: 'user-1', email: 'user@example.com', memberships: []}),
    );
    return Promise.resolve();
  },
};

function duplicateSlugError(): Error {
  const error = new Error('duplicate connection');
  error.name = 'IntegrationConnectionAlreadyExistsError';
  return error;
}

function fakeConnection(overrides: Partial<IntegrationConnection> = {}): IntegrationConnection {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    provider: 'webhook',
    externalAccountId: 'stripe',
    displayName: 'Stripe',
    lifecycleStatus: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createStore() {
  const byId = new Map<string, IntegrationConnection>();
  const byUnique = new Map<string, string>();
  const seed = (connection: IntegrationConnection) => {
    byId.set(connection.id, connection);
    byUnique.set(
      `${connection.workspaceId}:${connection.provider}:${connection.externalAccountId}`,
      connection.id,
    );
    return connection;
  };

  return {
    seed,
    createIntegrationConnection: vi.fn<CreateConnectionFn>((input) => {
      const key = `${input.workspaceId}:${input.provider}:${input.externalAccountId}`;
      if (byUnique.has(key)) throw duplicateSlugError();
      const connection = fakeConnection({
        workspaceId: input.workspaceId,
        provider: input.provider,
        externalAccountId: input.externalAccountId,
        displayName: input.displayName,
        lifecycleStatus: input.lifecycleStatus ?? 'active',
      });
      seed(connection);
      return Promise.resolve(connection);
    }),
    listIntegrationConnections: vi.fn<ListConnectionsFn>(({workspaceId}) =>
      Promise.resolve(
        [...byId.values()].filter((connection) => connection.workspaceId === workspaceId),
      ),
    ),
    getIntegrationConnectionById: vi.fn<GetConnectionFn>((id) => Promise.resolve(byId.get(id))),
    updateIntegrationConnectionLifecycleStatus: vi.fn<UpdateConnectionFn>(
      ({id, lifecycleStatus}) => {
        const connection = byId.get(id);
        if (!connection) return Promise.resolve(undefined);
        const updated = {...connection, lifecycleStatus, updatedAt: new Date()};
        byId.set(id, updated);
        return Promise.resolve(updated);
      },
    ),
    deleteIntegrationConnection: vi.fn<DeleteConnectionFn>(({id}) =>
      Promise.resolve(byId.delete(id)),
    ),
  };
}

async function createTestApp(store = createStore()): Promise<{
  app: FastifyInstance;
  store: ReturnType<typeof createStore>;
}> {
  const provider = createWebhookIntegrationProvider({
    baseUrl: 'https://api.example.com/',
    coreDb: () => ({transaction: (callback) => callback({})}),
    publishIntegrationEventReceived: vi.fn(() => Promise.resolve({published: true})),
    ...store,
  } satisfies CreateWebhookIntegrationProviderOptions);
  const app = await createApp({
    auth: [fakeUserAuth],
    routes: provider.routes,
    swagger: false,
  });
  await app.ready();
  return {app, store};
}

describe('webhook connection routes', () => {
  beforeEach(async () => {
    await closeApp();
  });

  afterEach(async () => {
    await closeApp();
  });

  it('creates a webhook connection with its inbound URL', async () => {
    const workspaceId = crypto.randomUUID();
    const {app} = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: workspaceId, name: 'Stripe', slug: 'stripe-prod'},
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      workspace_id: workspaceId,
      name: 'Stripe',
      slug: 'stripe-prod',
      lifecycle_status: 'active',
      inbound_url: expect.stringMatching(INBOUND_URL_RE),
    });
  });

  it('returns 409 for a duplicate slug in the workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const {app} = await createTestApp();
    const payload = {workspace_id: workspaceId, name: 'Stripe', slug: 'stripe-prod'};

    const first = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('slug-already-exists');
  });

  it('lists only webhook connections for the workspace', async () => {
    const workspaceId = crypto.randomUUID();
    const store = createStore();
    const webhook = store.seed(fakeConnection({workspaceId, externalAccountId: 'stripe'}));
    store.seed(fakeConnection({workspaceId, provider: 'github', externalAccountId: 'gh'}));
    store.seed(fakeConnection({workspaceId: crypto.randomUUID(), externalAccountId: 'other'}));
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'GET',
      url: `/integrations/webhook/connections?workspace_id=${workspaceId}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().connections).toEqual([
      expect.objectContaining({id: webhook.id, slug: 'stripe'}),
    ]);
  });

  it('updates a webhook connection lifecycle status', async () => {
    const store = createStore();
    const connection = store.seed(fakeConnection());
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'PATCH',
      url: `/integrations/webhook/connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
      payload: {lifecycle_status: 'disabled'},
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().lifecycle_status).toBe('disabled');
  });

  it('deletes a webhook connection', async () => {
    const store = createStore();
    const connection = store.seed(fakeConnection());
    const {app} = await createTestApp(store);

    const res = await app.inject({
      method: 'DELETE',
      url: `/integrations/webhook/connections/${connection.id}`,
      headers: {authorization: 'Bearer user'},
    });

    expect(res.statusCode).toBe(204);
    expect(store.deleteIntegrationConnection).toHaveBeenCalledWith({id: connection.id});
  });

  it.each([
    {name: 'Reserved', slug: 'github'},
    {name: 'Malformed', slug: 'Stripe_Prod'},
  ])('rejects invalid slug $slug', async (payload) => {
    const {app} = await createTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/integrations/webhook/connections',
      headers: {authorization: 'Bearer user'},
      payload: {workspace_id: crypto.randomUUID(), ...payload},
    });

    expect(res.statusCode).toBe(400);
  });
});
