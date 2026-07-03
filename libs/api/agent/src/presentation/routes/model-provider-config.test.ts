import {complete} from '@earendil-works/pi-ai';
import type {ModelProviderRef} from '@shipfox/api-agent-dto';
import {AUTH_USER, buildUserContext, setUserContext} from '@shipfox/api-auth-context';
import {getSecretsByNamespace, setSecrets} from '@shipfox/api-secrets';
import {requireMembership} from '@shipfox/api-workspaces';
import type {AuthMethod, FastifyRequest} from '@shipfox/node-fastify';
import {ClientError, closeApp, createApp} from '@shipfox/node-fastify';
import {eq} from 'drizzle-orm';
import {agentSystemNamespace} from '#core/credential-fingerprints.js';
import {db} from '#db/db.js';
import {
  getAgentWorkspaceSettings,
  getModelProviderConfig,
  setDefaultModelProvider,
  upsertModelProviderConfig,
} from '#db/index.js';
import {modelProviderConfigs} from '#db/schema/model-provider-configs.js';
import {agentRoutes} from './index.js';

vi.mock('@shipfox/api-workspaces', () => ({
  requireMembership: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai')>();
  return {...actual, complete: vi.fn()};
});

const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';

const fakeUserAuth: AuthMethod = {
  name: AUTH_USER,
  authenticate: (request: FastifyRequest) => {
    if (request.headers.authorization !== 'Bearer user') {
      throw new ClientError('Invalid user token', 'unauthorized', {status: 401});
    }

    setUserContext(
      request,
      buildUserContext({
        userId: AUTH_USER_ID,
        email: 'user@example.com',
        memberships: [{workspaceId: 'workspace-from-auth', role: 'admin'}],
      }),
    );
    return Promise.resolve();
  },
};

describe('model provider config routes', () => {
  let app: Awaited<ReturnType<typeof createApp>>;
  let workspaceId: string;

  beforeEach(async () => {
    await closeApp();
    workspaceId = crypto.randomUUID();
    vi.mocked(complete).mockReset();
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
      userId: AUTH_USER_ID,
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

  describe('GET /workspaces/:workspaceId/agent/model-providers', () => {
    it('returns 401 without client auth', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/model-providers`,
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when the user is not a workspace member', async () => {
      vi.mocked(requireMembership).mockRejectedValueOnce(
        new ClientError('Not a member of this workspace', 'forbidden', {status: 403}),
      );

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/model-providers`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('forbidden');
    });

    it('returns an empty list with no default model provider', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/model-providers`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({configs: [], default_provider_id: null});
    });

    it('returns provider configs and the workspace default model provider', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});
      await seedModelProviderConfig({providerId: 'openai'});
      await setDefaultModelProvider({workspaceId, providerId: 'openai'});

      const res = await app.inject({
        method: 'GET',
        url: `/workspaces/${workspaceId}/agent/model-providers`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().default_provider_id).toBe('openai');
      expect(res.json().configs.map((config: {provider_id: string}) => config.provider_id)).toEqual(
        ['anthropic', 'openai'],
      );
    });
  });

  describe('PUT /workspaces/:workspaceId/agent/model-providers/:providerId', () => {
    it('tests, saves, and replaces a provider config without exposing credentials', async () => {
      const secret = 'sk-ant-secret-abcd';

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: secret}},
      });
      const replace = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'sk-ant-rotated-wxyz'}},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().provider_id).toBe('anthropic');
      expect(res.json().default_model).toBeNull();
      expect(res.json().key_fingerprints).toEqual({'credential:api_key': '...abcd'});
      expect(res.body).not.toContain(secret);
      expect(res.body).not.toContain('encrypted_credentials');
      expect(replace.statusCode).toBe(200);
      expect(replace.json().default_model).toBeNull();
      expect(replace.json().key_fingerprints).toEqual({'credential:api_key': '...wxyz'});
      const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
      const secrets = await getSecretsByNamespace({
        workspaceId,
        namespace: agentSystemNamespace('anthropic'),
      });
      expect(secrets).toEqual({API_KEY: 'sk-ant-rotated-wxyz'});
      expect(stored?.defaultModel).toBeNull();
    });

    it('saves an explicit default model for a provider config', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {
          default_model: 'claude-haiku-4-5',
          credentials: {api_key: 'sk-ant-secret-abcd'},
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().default_model).toBe('claude-haiku-4-5');
      const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
      expect(stored?.defaultModel).toBe('claude-haiku-4-5');
    });

    it('sets the provider as the workspace default when requested', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {
          credentials: {api_key: 'sk-ant-secret-abcd'},
          set_as_default: true,
        },
      });

      const settings = await getAgentWorkspaceSettings(workspaceId);
      expect(res.statusCode).toBe(200);
      expect(settings?.defaultProviderId).toBe('anthropic');
    });

    it('passes a request-scoped abort signal to provider validation', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'sk-ant-secret-abcd'}},
      });

      const [, , options] = vi.mocked(complete).mock.calls[0] ?? [];
      expect(res.statusCode).toBe(200);
      expect(complete).toHaveBeenCalledTimes(1);
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect(options?.signal?.aborted).toBe(false);
    });

    it('replaces the workspace default when set_as_default is requested with existing settings', async () => {
      await seedModelProviderConfig({providerId: 'openai'});
      await setDefaultModelProvider({workspaceId, providerId: 'openai'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {
          credentials: {api_key: 'sk-ant-secret-abcd'},
          set_as_default: true,
        },
      });

      const settings = await getAgentWorkspaceSettings(workspaceId);
      expect(res.statusCode).toBe(200);
      expect(settings?.defaultProviderId).toBe('anthropic');
    });

    it('does not change the workspace default when set_as_default is omitted', async () => {
      await seedModelProviderConfig({providerId: 'openai'});
      await setDefaultModelProvider({workspaceId, providerId: 'openai'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'sk-ant-secret-abcd'}},
      });

      const settings = await getAgentWorkspaceSettings(workspaceId);
      expect(res.statusCode).toBe(200);
      expect(settings?.defaultProviderId).toBe('openai');
    });

    it('preserves the existing default model when replacing credentials without default_model', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'sk-ant-rotated-wxyz'}},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().default_model).toBe('claude-opus-4-8');
      expect(res.json().key_fingerprints).toEqual({'credential:api_key': '...wxyz'});
      const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
      expect(stored?.defaultModel).toBe('claude-opus-4-8');
    });

    it('stores Latest when replacing credentials with a null default_model', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {default_model: null, credentials: {api_key: 'sk-ant-rotated-wxyz'}},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().default_model).toBeNull();
      expect(res.json().key_fingerprints).toEqual({'credential:api_key': '...wxyz'});
      const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
      expect(stored?.defaultModel).toBeNull();
    });

    it('returns sanitized provider validation errors without leaking the submitted secret', async () => {
      const secret = 'sk-route-secret-leak-sentinel';
      vi.mocked(complete).mockRejectedValueOnce(new Error(`provider rejected ${secret}`));

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
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
        url: `/workspaces/${workspaceId}/agent/model-providers/cloudflare-ai-gateway`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'cf-secret-abcd'}},
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('invalid-credential-fields');
      expect(res.json().details.expected_keys).toEqual(['account_id', 'api_key', 'gateway_id']);
    });

    it('maps store value-size errors to a client error', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'a'.repeat(64 * 1024 + 1)}},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('value-too-large');
    });

    it('returns 400 for an unsupported provider id', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/amazon-bedrock`,
        headers: {authorization: 'Bearer user'},
        payload: {credentials: {api_key: 'secret'}},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('DELETE /workspaces/:workspaceId/agent/model-providers/:providerId', () => {
    it('deletes a provider config', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(204);
      const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
      const secrets = await getSecretsByNamespace({
        workspaceId,
        namespace: agentSystemNamespace('anthropic'),
      });
      expect(stored).toBeUndefined();
      expect(secrets).toEqual({});
    });

    it('returns 404 for a missing or foreign provider config', async () => {
      await seedModelProviderConfig({
        providerId: 'anthropic',
        workspaceId: crypto.randomUUID(),
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('not-found');
    });

    it('clears the workspace default when deleting the default model provider config', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});
      await setDefaultModelProvider({workspaceId, providerId: 'anthropic'});

      const res = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(204);
      const settings = await getAgentWorkspaceSettings(workspaceId);
      expect(settings?.defaultProviderId).toBeNull();
    });

    it('deletes a configured custom model provider ref', async () => {
      await seedCustomModelProviderConfig({providerId: 'local-vllm'});

      const res = await app.inject({
        method: 'DELETE',
        url: `/workspaces/${workspaceId}/agent/model-providers/local-vllm`,
        headers: {authorization: 'Bearer user'},
      });

      expect(res.statusCode).toBe(204);
      const stored = await getModelProviderConfig({workspaceId, providerId: 'local-vllm'});
      expect(stored).toBeUndefined();
    });
  });

  describe('POST /workspaces/:workspaceId/agent/custom-model-providers', () => {
    it('tests and creates a custom model provider without exposing secrets', async () => {
      const secret = 'sk-local-secret-abcd';
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('{}'));

      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/agent/custom-model-providers`,
        headers: {authorization: 'Bearer user'},
        payload: {
          slug: 'local-vllm',
          display_name: 'Local vLLM',
          api: 'openai-responses',
          base_url: 'http://127.0.0.1:11434/v1',
          api_key: secret,
          headers: [
            {name: 'authorization', value: 'Bearer local', secret: true},
            {name: 'x-region', value: 'local', secret: false},
          ],
          models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
        },
      });

      const [probeUrl, probeInit] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        kind: 'custom',
        provider_id: 'local-vllm',
        display_name: 'Local vLLM',
        secret_header_names: ['authorization'],
        headers: [{name: 'x-region', value: 'local'}],
      });
      expect(probeUrl).toBe('http://127.0.0.1:11434/v1/responses');
      expect(probeInit).toMatchObject({method: 'POST', redirect: 'error'});
      expect((probeInit.headers as Headers).get('authorization')).toBe(`Bearer ${secret}`);
      expect((probeInit.headers as Headers).get('x-region')).toBe('local');
      expect(res.body).not.toContain(secret);
    });
  });

  describe('POST /workspaces/:workspaceId/agent/custom-model-providers/discover-models', () => {
    it('returns discovered models from an OpenAI-compatible response', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({data: [{id: 'llama-3.1'}]}), {
          status: 200,
          headers: {'content-type': 'application/json'},
        }),
      );

      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/agent/custom-model-providers/discover-models`,
        headers: {authorization: 'Bearer user'},
        payload: {
          api: 'openai-responses',
          base_url: 'http://127.0.0.1:11434/v1',
          api_key: 'sk-local',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({models: [{id: 'llama-3.1', label: 'llama-3.1'}]});
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:11434/v1/models',
        expect.objectContaining({
          redirect: 'error',
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('returns an empty model list on discovery fetch failures', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('redirect'));

      const res = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspaceId}/agent/custom-model-providers/discover-models`,
        headers: {authorization: 'Bearer user'},
        payload: {
          api: 'openai-responses',
          base_url: 'http://127.0.0.1:11434/v1',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({models: []});
    });
  });

  describe('PUT /workspaces/:workspaceId/agent/model-providers/:providerId/default-model', () => {
    it('updates the provider default model without changing credentials', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic/default-model`,
        headers: {authorization: 'Bearer user'},
        payload: {default_model: 'claude-haiku-4-5'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().default_model).toBe('claude-haiku-4-5');
      expect(res.json().key_fingerprints).toEqual({'credential:api_key': '...abcd'});
      const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
      expect(stored?.defaultModel).toBe('claude-haiku-4-5');
    });

    it('stores Latest as a null provider default model', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic/default-model`,
        headers: {authorization: 'Bearer user'},
        payload: {default_model: null},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().default_model).toBeNull();
      const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
      expect(stored?.defaultModel).toBeNull();
    });

    it('returns 422 when updating a default model for a missing provider config', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic/default-model`,
        headers: {authorization: 'Bearer user'},
        payload: {default_model: null},
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('provider-not-configured');
    });

    it('returns 422 when the selected default model is unsupported', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/model-providers/anthropic/default-model`,
        headers: {authorization: 'Bearer user'},
        payload: {default_model: 'missing-model'},
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('invalid-agent-model');
      expect(res.json().details.model).toBe('missing-model');
    });
  });

  describe('PUT /workspaces/:workspaceId/agent/default-model-provider', () => {
    it('sets a configured provider as the workspace default', async () => {
      await seedModelProviderConfig({providerId: 'anthropic'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/default-model-provider`,
        headers: {authorization: 'Bearer user'},
        payload: {provider_id: 'anthropic'},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({default_provider_id: 'anthropic'});
    });

    it('returns 422 when the provider is not configured', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/default-model-provider`,
        headers: {authorization: 'Bearer user'},
        payload: {provider_id: 'anthropic'},
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('provider-not-configured');
      expect(res.json().details.provider_id).toBe('anthropic');
    });

    it('rejects a configured custom model provider as the workspace default until execution is wired', async () => {
      await seedCustomModelProviderConfig({providerId: 'local-vllm'});

      const res = await app.inject({
        method: 'PUT',
        url: `/workspaces/${workspaceId}/agent/default-model-provider`,
        headers: {authorization: 'Bearer user'},
        payload: {provider_id: 'local-vllm'},
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('custom-provider-default-unsupported');
      expect(res.json().details.provider_id).toBe('local-vllm');
    });
  });

  async function seedModelProviderConfig(params: {
    providerId: ModelProviderRef;
    workspaceId?: string;
  }) {
    const config = await upsertModelProviderConfig({
      workspaceId: params.workspaceId ?? workspaceId,
      providerId: params.providerId,
      keyFingerprints: {'credential:api_key': '...abcd'},
      defaultModel: params.providerId === 'anthropic' ? 'claude-opus-4-8' : 'gpt-5.5-pro',
      defaultThinking: 'high',
    });

    const rows = await db()
      .select()
      .from(modelProviderConfigs)
      .where(eq(modelProviderConfigs.id, config.id));
    await setSecrets({
      workspaceId: params.workspaceId ?? workspaceId,
      namespace: agentSystemNamespace(params.providerId),
      values: {API_KEY: 'seeded-secret'},
    });
    expect(rows).toHaveLength(1);
  }

  async function seedCustomModelProviderConfig(params: {
    providerId: ModelProviderRef;
    workspaceId?: string;
  }) {
    const config = await upsertModelProviderConfig({
      workspaceId: params.workspaceId ?? workspaceId,
      providerId: params.providerId,
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      keyFingerprints: {'credential:api_key': '...abcd'},
      defaultModel: 'llama-3.1',
      defaultThinking: 'off',
    });

    const rows = await db()
      .select()
      .from(modelProviderConfigs)
      .where(eq(modelProviderConfigs.id, config.id));
    await setSecrets({
      workspaceId: params.workspaceId ?? workspaceId,
      namespace: agentSystemNamespace(params.providerId),
      values: {API_KEY: 'seeded-secret'},
    });
    expect(rows).toHaveLength(1);
  }
});
