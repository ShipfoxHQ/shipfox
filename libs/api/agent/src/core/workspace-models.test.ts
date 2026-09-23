import type {AgentThinking, ManagedModelProvider, ModelReference} from '@shipfox/api-agent-dto';
import {setDefaultHarness, upsertModelProviderConfig} from '#db/index.js';
import {getWorkspaceModels} from './workspace-models.js';

const scale = 'aa-v1-swe-bench';

function reference(
  thinking: AgentThinking,
  intelligenceIndex: number,
  costPerTaskUsd: number,
  referenceScale = scale,
) {
  return {
    thinking,
    intelligence_index: intelligenceIndex,
    cost_per_task_usd: costPerTaskUsd,
    scale: referenceScale,
  } satisfies ModelReference;
}

function createManagedProvider(
  models: ManagedModelProvider['models'],
  defaultModel = models[0]?.id ?? 'managed-model',
): ManagedModelProvider {
  return {
    id: 'shipfox',
    label: 'Shipfox',
    models,
    defaultModel,
    resolveCredentials: vi.fn(),
  };
}

describe('getWorkspaceModels', () => {
  test('returns an empty result for a workspace without a configured provider', async () => {
    const workspaceId = crypto.randomUUID();

    const result = await getWorkspaceModels(workspaceId);

    expect(result).toEqual({models: [], default_model: null, attribution: null});
  });

  test('returns configured built-in models with Pi prices and no references', async () => {
    const workspaceId = crypto.randomUUID();
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'openai',
      defaultModel: 'gpt-5.5-pro',
      defaultThinking: 'medium',
      setAsDefault: true,
    });

    const result = await getWorkspaceModels(workspaceId);
    const model = result.models.find(({id}) => id === 'gpt-5.5-pro');

    expect(model).toMatchObject({
      id: 'gpt-5.5-pro',
      provider: 'openai',
      harness: 'pi',
      thinking: 'medium',
      is_default: true,
      supported_thinking: expect.arrayContaining(['medium', 'high', 'xhigh']),
      references: [],
    });
    expect(model?.price).toEqual({input: expect.any(Number), output: expect.any(Number)});
    expect(result.attribution).toBeNull();
    expect(result.default_model).toEqual(model);
  });

  test('returns custom provider models without measured references', async () => {
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

    expect(result.models).toEqual([
      {
        id: 'llama-3.1',
        provider: 'local-vllm',
        harness: 'pi',
        thinking: 'low',
        supported_thinking: ['off'],
        is_default: true,
        price: null,
        references: [],
      },
    ]);
    expect(result.attribution).toBeNull();
  });

  test('returns scored managed models and marks the workspace default', async () => {
    const workspaceId = crypto.randomUUID();
    const provider = createManagedProvider([
      {
        id: 'managed-strong',
        label: 'Managed strong',
        api: 'openai-responses',
        price: {input: 2, output: 8},
        reasoning: true,
        references: [reference('low', 90, 0.12), reference('high', 85, 0.14)],
      },
      {
        id: 'managed-small',
        label: 'Managed small',
        api: 'openai-responses',
        price: {input: 0.5, output: 2},
        reasoning: true,
        references: [reference('high', 60, 0.02)],
      },
    ]);

    const result = await getWorkspaceModels(workspaceId, provider);

    expect(result.models).toEqual([
      {
        id: 'managed-strong',
        provider: 'shipfox',
        harness: 'pi',
        thinking: 'xhigh',
        supported_thinking: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        is_default: true,
        price: {input: 2, output: 8},
        references: [reference('low', 90, 0.12), reference('high', 85, 0.14)],
      },
      {
        id: 'managed-small',
        provider: 'shipfox',
        harness: 'pi',
        thinking: 'xhigh',
        supported_thinking: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
        is_default: false,
        price: {input: 0.5, output: 2},
        references: [reference('high', 60, 0.02)],
      },
    ]);
    expect(result.default_model).toEqual(result.models[0]);
    expect(result.attribution).toBeTypeOf('string');
  });

  test('keeps attribution for a mixed scored and unscored catalog', async () => {
    const workspaceId = crypto.randomUUID();
    const provider = createManagedProvider([
      {
        id: 'managed-scored',
        label: 'Managed scored',
        api: 'openai-responses',
        reasoning: true,
        references: [reference('medium', 80, 0.1)],
      },
      {id: 'managed-unscored', label: 'Managed unscored', api: 'openai-responses'},
    ]);

    const result = await getWorkspaceModels(workspaceId, provider);

    expect(result.models.map(({references}) => references)).toEqual([
      [reference('medium', 80, 0.1)],
      [],
    ]);
    expect(result.attribution).toBeTypeOf('string');
  });

  test('preserves mixed reference scales without comparing them', async () => {
    const workspaceId = crypto.randomUUID();
    const provider = createManagedProvider([
      {
        id: 'managed-v1',
        label: 'Managed v1',
        api: 'openai-responses',
        reasoning: true,
        references: [reference('low', 80, 0.1, 'aa-v1-swe-bench')],
      },
      {
        id: 'managed-v2',
        label: 'Managed v2',
        api: 'openai-responses',
        reasoning: true,
        references: [reference('low', 82, 0.08, 'aa-v2-repo-task')],
      },
    ]);

    const result = await getWorkspaceModels(workspaceId, provider);

    expect(result.models.map(({references}) => references[0]?.scale)).toEqual([
      'aa-v1-swe-bench',
      'aa-v2-repo-task',
    ]);
    expect(result.attribution).toBeTypeOf('string');
  });

  test('omits measured levels that the model explicitly does not support', async () => {
    const workspaceId = crypto.randomUUID();
    const provider = createManagedProvider([
      {
        id: 'managed-limited',
        label: 'Managed limited',
        api: 'openai-responses',
        reasoning: true,
        thinkingLevelMap: {high: null},
        references: [reference('low', 70, 0.04), reference('high', 75, 0.05)],
      },
    ]);

    const result = await getWorkspaceModels(workspaceId, provider);

    expect(result.models[0]?.supported_thinking).not.toContain('high');
    expect(result.models[0]?.references).toEqual([reference('low', 70, 0.04)]);
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
      models: [
        {
          id: 'llama-3.1',
          provider: 'local-vllm',
          harness: 'pi',
          thinking: 'low',
          supported_thinking: ['off'],
          is_default: true,
          price: null,
          references: [],
        },
      ],
      default_model: expect.objectContaining({id: 'llama-3.1'}),
      attribution: null,
    });
  });

  test('marks no model as default when the workspace has no default', async () => {
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
      setAsDefault: false,
    });

    const result = await getWorkspaceModels(workspaceId);

    expect(result.models[0]?.is_default).toBe(false);
    expect(result.default_model).toBeNull();
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

    expect(result).toEqual({models: [], default_model: null, attribution: null});
  });

  test('returns only the managed provider when workspace providers are disabled', async () => {
    const workspaceId = crypto.randomUUID();
    const provider = createManagedProvider([
      {id: 'managed-model', label: 'Managed model', api: 'openai-responses'},
    ]);

    const result = await getWorkspaceModels(workspaceId, provider, 'disabled');

    expect(result.models).toEqual([
      expect.objectContaining({
        id: 'managed-model',
        provider: 'shipfox',
        is_default: true,
        supported_thinking: ['off'],
        references: [],
      }),
    ]);
    expect(result.default_model).toEqual(result.models[0]);
  });
});
