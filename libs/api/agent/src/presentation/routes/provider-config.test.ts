import {complete} from '@earendil-works/pi-ai';
import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {requireMembership} from '@shipfox/api-workspaces';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {eq, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {
  getAgentProviderConfig,
  getAgentWorkspaceSettings,
  setDefaultAgentProvider,
  upsertAgentProviderConfig,
} from '#db/index.js';
import {agentProviderConfigs} from '#db/schema/agent-provider-configs.js';
import {agentRoutes} from './index.js';

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai')>();
  return {...actual, complete: vi.fn()};
});

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
        memberships: [{workspaceId: 'workspace-from-auth', role: 'admin'}],
      }),
    );
    return Promise.resolve();
  },
};

describe('agent provider config routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    await db().execute(sql`TRUNCATE agent_provider_configs CASCADE`);
    await db().execute(sql`TRUNCATE agent_workspace_settings CASCADE`);
    workspaceId = crypto.randomUUID();
    vi.mocked(complete).mockResolvedValue({
      role: 'assistant',
      content: [{type: 'text', text: 'OK'}],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      diagnostics: [],
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    });
    vi.mocked(requireMembership).mockResolvedValue({
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
    });
    app = await createApp({
      auth: [fakeUserAuth],
      routes: agentRoutes,
      swagger: false,
    });
    await app.ready();
  });

  afterEach(async () => {
    await closeApp();
  });

  test('uses client user auth for agent route groups', () => {
    expect(agentRoutes[0]?.auth).toBe(AUTH_USER);
    expect(agentRoutes[1]?.auth).toBe(AUTH_USER);
  });

  describe('GET /workspaces/:workspaceId/agent/providers', () => {
    it('returns 401 without client auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/providers`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when the user is not a workspace member', async () => {
      vi.mocked(requireMembership).mockRejectedValueOnce(
        new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/providers`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('forbidden');
    });

    it('returns an empty list with no default provider', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/providers`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({configs: [], default_provider_id: null});
    });

    it('returns provider configs and the workspace default provider', async () => {
      await seedProviderConfig({providerId: 'anthropic'});
      await seedProviderConfig({providerId: 'openai'});
      await setDefaultAgentProvider({workspaceId, providerId: 'openai'});

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/providers`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().default_provider_id).toBe('openai');
      expect(res.json().configs.map((config: {provider_id: string}) => config.provider_id)).toEqual(
        ['anthropic', 'openai'],
      );
    });
  });

  describe('PUT /workspaces/:workspaceId/agent/providers/:providerId', () => {
    it('tests, saves, and replaces a provider config without exposing credentials', async () => {
      const secret = 'sk-ant-secret-abcd';

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: secret}},
      });
      const replace = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'sk-ant-rotated-wxyz'}},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().provider_id).toBe('anthropic');
      expect(res.json().key_fingerprints).toEqual({api_key: 'sk-ant-s...abcd'});
      expect(res.body).not.toContain(secret);
      expect(res.body).not.toContain('encrypted_credentials');
      expect(replace.statusCode).toBe(200);
      expect(replace.json().key_fingerprints).toEqual({api_key: 'sk-ant-r...wxyz'});
      const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
      expect(stored?.encryptedCredentials.api_key).not.toBeUndefined();
      expect(stored?.encryptedCredentials.api_key).not.toContain(secret);
    });

    it('returns sanitized provider validation errors without leaking the submitted secret', async () => {
      const secret = 'sk-route-secret-leak-sentinel';
      vi.mocked(complete).mockRejectedValueOnce(new Error(`provider rejected ${secret}`));

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: secret}},
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('provider-validation-failed');
      expect(res.json().details.message).toContain('***');
      expect(res.body).not.toContain(secret);
    });

    it('returns expected credential keys for wrong credential fields', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/providers/cloudflare-ai-gateway`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'cf-secret-abcd'}},
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('invalid-credential-fields');
      expect(res.json().details.expected_keys).toEqual(['account_id', 'api_key', 'gateway_id']);
    });

    it('returns 400 for an unsupported provider id', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/providers/amazon-bedrock`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'secret'}},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /workspaces/:workspaceId/agent/providers/:providerId', () => {
    it('deletes a provider config', async () => {
      await seedProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/agent/providers/anthropic`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(204);
      const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
      expect(stored).toBeUndefined();
    });

    it('returns 404 for a missing or foreign provider config', async () => {
      await seedProviderConfig({providerId: 'anthropic', workspaceId: crypto.randomUUID()});

      const res = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/agent/providers/anthropic`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not-found');
    });

    it('clears the workspace default when deleting the default provider config', async () => {
      await seedProviderConfig({providerId: 'anthropic'});
      await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

      const res = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/agent/providers/anthropic`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(204);
      const settings = await getAgentWorkspaceSettings(workspaceId);
      expect(settings?.defaultProviderId).toBeNull();
    });
  });

  describe('PUT /workspaces/:workspaceId/agent/default-provider', () => {
    it('sets a configured provider as the workspace default', async () => {
      await seedProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/default-provider`,
        headers: {authorization: 'Bearer user'},
        payload: {provider_id: 'anthropic'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({default_provider_id: 'anthropic'});
    });

    it('returns 422 when the provider is not configured', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/default-provider`,
        headers: {authorization: 'Bearer user'},
        payload: {provider_id: 'anthropic'},
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('provider-not-configured');
      expect(res.json().details.provider_id).toBe('anthropic');
    });
  });

  async function seedProviderConfig(params: {
    providerId: 'anthropic' | 'openai';
    workspaceId?: string;
  }) {
    const config = await upsertAgentProviderConfig({
      workspaceId: params.workspaceId ?? workspaceId,
      providerId: params.providerId,
      encryptedCredentials: {api_key: 'encrypted-secret'},
      keyFingerprints: {api_key: 'sk-secre...abcd'},
      defaultModel: params.providerId === 'anthropic' ? 'claude-opus-4-8' : 'gpt-5.5-pro',
      defaultThinking: 'high',
    });

    const rows = await db()
      .select()
      .from(agentProviderConfigs)
      .where(eq(agentProviderConfigs.id, config.id));
    expect(rows).toHaveLength(1);
  }
});
