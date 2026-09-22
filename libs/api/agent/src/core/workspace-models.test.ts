import type {ManagedModelProvider} from '@shipfox/api-agent-dto';
import {setDefaultHarness, upsertModelProviderConfig} from '#db/index.js';
import {getWorkspaceModels} from './workspace-models.js';

describe('getWorkspaceModels', () => {
  test('returns an empty result for a workspace without a configured provider', async () => {
    const workspaceId = crypto.randomUUID();

    const result = await getWorkspaceModels(workspaceId);

    expect(result).toEqual({models: [], default_model: null});
  });

  test('returns models only for configured built-in providers', async () => {
    const workspaceId = crypto.randomUUID();
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'openai',
      defaultModel: 'gpt-5.5-pro',
      defaultThinking: 'medium',
      setAsDefault: true,
    });

    const result = await getWorkspaceModels(workspaceId);

    expect(result.models.length).toBeGreaterThan(0);
    expect(new Set(result.models.map(({provider}) => provider))).toEqual(new Set(['openai']));
    expect(result.models).toContainEqual({id: 'gpt-5.5-pro', provider: 'openai'});
    expect(result.default_model).toEqual({id: 'gpt-5.5-pro', provider: 'openai'});
  });

  test('returns configured custom provider models for the pi harness', async () => {
    const workspaceId = crypto.randomUUID();
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'http://127.0.0.1:11434/v1',
      headers: [],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      defaultModel: null,
      defaultThinking: 'low',
      setAsDefault: true,
    });

    const result = await getWorkspaceModels(workspaceId);

    expect(result).toEqual({
      models: [{id: 'llama-3.1', provider: 'local-vllm'}],
      default_model: {id: 'llama-3.1', provider: 'local-vllm'},
    });
  });

  test('returns an empty result when configured providers do not support the default harness', async () => {
    const workspaceId = crypto.randomUUID();
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'openai',
      defaultModel: 'gpt-5.5-pro',
      defaultThinking: 'medium',
      setAsDefault: true,
    });
    await setDefaultHarness({workspaceId, harnessId: 'claude'});

    const result = await getWorkspaceModels(workspaceId);

    expect(result).toEqual({models: [], default_model: null});
  });

  test('returns only the managed provider when workspace providers are disabled', async () => {
    const workspaceId = crypto.randomUUID();
    const managedProvider: ManagedModelProvider = {
      id: 'shipfox',
      label: 'Shipfox',
      models: [{id: 'managed-model', label: 'Managed model', api: 'openai-responses'}],
      defaultModel: 'managed-model',
      resolveCredentials: vi.fn(),
    };

    const result = await getWorkspaceModels(workspaceId, managedProvider, 'disabled');

    expect(result).toEqual({
      models: [{id: 'managed-model', provider: 'shipfox'}],
      default_model: {id: 'managed-model', provider: 'shipfox'},
    });
  });
});
