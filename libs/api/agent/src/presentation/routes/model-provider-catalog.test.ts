import {
  type ManagedModelLock,
  type ManagedModelProvider,
  MODEL_PROVIDER_IDS,
} from '@shipfox/api-agent-dto';
import {
  AUTH_USER,
  buildUserContext,
  setUserContext,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {agentRoutes, createAgentRoutes} from './index.js';

let authenticatedMemberships: UserContextMembership[] = [];

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: 'user-1',
        email: 'user@example.com',
        memberships: authenticatedMemberships,
      }),
    );
    return Promise.resolve();
  },
};

describe('model provider catalog route', () => {
  let app: Awaited<ReturnType<typeof createApp>>;

  beforeEach(async () => {
    await closeApp();
    authenticatedMemberships = [];
    app = await createApp({
      auth: [fakeUserAuth],
      routes: agentRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
    vi.unstubAllEnvs();
  });

  describe('GET /agent/model-provider-catalog', () => {
    it('returns 401 without client auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns model providers with supported models and unsupported empty model lists', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        workspace_providers: 'enabled',
        managed_provider_id: null,
        instance_default_provider_id: null,
      });
      expect(res.json().providers).toHaveLength(MODEL_PROVIDER_IDS.length);
      for (const provider of res.json().providers) {
        if (provider.support_status === 'supported') {
          expect(provider.models.length).toBeGreaterThan(0);
          expect(
            provider.models.some((model: {id: string}) => model.id === provider.default_model),
          ).toBe(true);
        } else {
          expect(provider.models).toEqual([]);
        }
      }
    });

    it('returns only the managed provider and the disabled policy when configured', async () => {
      await closeApp();
      app = await createApp({
        auth: [fakeUserAuth],
        routes: createAgentRoutes(undefined as never, {
          managedProvider: managedProvider(),
          workspaceProviders: 'disabled',
        }),
        swagger: false,
      });
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        workspace_providers: 'disabled',
        managed_provider_id: 'shipfox',
        instance_default_provider_id: null,
        providers: [
          expect.objectContaining({
            id: 'shipfox',
            support_status: 'supported',
            default_model: 'managed-claude',
            credential_fields: [],
            models: [{id: 'managed-claude', label: 'Managed Claude', api: 'anthropic-messages'}],
          }),
        ],
      });
    });

    it('appends the managed provider to the full catalog with its id under the enabled policy', async () => {
      await closeApp();
      app = await createApp({
        auth: [fakeUserAuth],
        routes: createAgentRoutes(undefined as never, {
          managedProvider: managedProvider(),
          workspaceProviders: 'enabled',
        }),
        swagger: false,
      });
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        workspace_providers: 'enabled',
        managed_provider_id: 'shipfox',
        instance_default_provider_id: null,
      });
      expect(res.json().providers).toHaveLength(MODEL_PROVIDER_IDS.length + 1);
      expect(res.json().providers.at(-1)).toMatchObject({
        id: 'shipfox',
        support_status: 'supported',
        credential_fields: [],
      });
    });

    it('returns the instance default provider id when AGENT_DEFAULT_PROVIDER is set', async () => {
      vi.resetModules();
      vi.stubEnv('AGENT_DEFAULT_PROVIDER', 'anthropic');
      const {createAgentRoutes: freshCreateAgentRoutes} = await import('./index.js');

      await closeApp();
      app = await createApp({
        auth: [fakeUserAuth],
        routes: freshCreateAgentRoutes(undefined as never),
        swagger: false,
      });
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        workspace_providers: 'enabled',
        managed_provider_id: null,
        instance_default_provider_id: 'anthropic',
      });
    });

    it('maps a blank instance default provider id to null', async () => {
      vi.resetModules();
      vi.stubEnv('AGENT_DEFAULT_PROVIDER', '');
      const {createAgentRoutes: freshCreateAgentRoutes} = await import('./index.js');

      await closeApp();
      app = await createApp({
        auth: [fakeUserAuth],
        routes: freshCreateAgentRoutes(undefined as never),
        swagger: false,
      });
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/agent/model-provider-catalog',
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        managed_provider_id: null,
        instance_default_provider_id: null,
      });
    });
  });

  describe('GET /workspaces/:workspaceId/agent/model-provider-catalog', () => {
    const workspaceId = crypto.randomUUID();

    async function appWithManagedProvider(availability?: ManagedModelProvider['availability']) {
      await closeApp();
      authenticatedMemberships = [{workspaceId, role: 'admin', workspaceStatus: 'active'}];
      app = await createApp({
        auth: [fakeUserAuth],
        routes: createAgentRoutes(undefined as never, {
          managedProvider: managedProvider(availability),
          workspaceProviders: 'disabled',
        }),
        swagger: false,
      });
      await app.ready();
    }

    function getCatalog() {
      return app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/model-provider-catalog`,
        headers: {authorization: 'Bearer user'},
      });
    }

    it('marks a locked managed model with its label and notice', async () => {
      const availability = vi.fn().mockResolvedValue(new Map([['managed-claude', lock]]));
      await appWithManagedProvider(availability);

      const res = await getCatalog();

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().providers[0].models).toEqual([
        {id: 'managed-claude', label: 'Managed Claude', api: 'anthropic-messages', locked: lock},
      ]);
      expect(availability).toHaveBeenCalledWith({workspaceId});
    });

    it('leaves models unmarked when the provider reports no locks', async () => {
      await appWithManagedProvider(vi.fn().mockResolvedValue(new Map()));

      const res = await getCatalog();

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().providers[0].models).toEqual([
        {id: 'managed-claude', label: 'Managed Claude', api: 'anthropic-messages'},
      ]);
    });

    it('still lists models when availability fails', async () => {
      await appWithManagedProvider(vi.fn().mockRejectedValue(new Error('limits unavailable')));

      const res = await getCatalog();

      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().providers[0].models[0]).not.toHaveProperty('locked');
    });

    it('returns 403 when the user is not a workspace member', async () => {
      await appWithManagedProvider();
      authenticatedMemberships = [];

      const res = await getCatalog();

      expect(res.statusCode).toBe(403);
    });
  });
});

const lock: ManagedModelLock = {
  label: 'Add credits to use',
  notice: {reason: 'model-locked', message: 'Managed Claude needs credits.'},
};

function managedProvider(
  availability?: ManagedModelProvider['availability'],
): ManagedModelProvider {
  return {
    ...(availability === undefined ? {} : {availability}),
    id: 'shipfox',
    label: 'Shipfox',
    models: [{id: 'managed-claude', label: 'Managed Claude', api: 'anthropic-messages'}],
    defaultModel: 'managed-claude',
    resolveCredentials: async () => ({
      api: 'anthropic-messages',
      baseUrl: 'https://gateway.example.com',
      credentials: {api_key: 'token'},
    }),
  };
}
