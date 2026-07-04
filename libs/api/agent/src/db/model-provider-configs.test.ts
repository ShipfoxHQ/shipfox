import crypto from 'node:crypto';
import type {
  AgentThinking,
  ModelProviderRef,
  SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {
  db,
  deleteModelProviderConfig,
  getAgentWorkspaceSettings,
  getModelProviderConfig,
  listModelProviderConfigs,
  setDefaultModelProvider,
  type UpsertModelProviderConfigParams,
  updateModelProviderDefaultModel,
  upsertModelProviderConfig,
} from '#db/index.js';
import {modelProviderConfigs} from './schema/model-provider-configs.js';

describe('model provider configs', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('persists a provider config for a workspace provider pair', async () => {
    const params = createModelProviderConfigParams({workspaceId, providerId: 'anthropic'});

    const created = await upsertModelProviderConfig(params);

    const found = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(found).toEqual(created);
    expect(found).toMatchObject({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-opus-4-8',
      defaultThinking: 'high',
      kind: 'builtin',
      displayName: null,
      api: null,
      baseUrl: null,
      headers: null,
      models: null,
    });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it('updates the existing config for the same workspace provider pair', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'openai'}),
    );

    const updated = await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        providerId: 'openai',
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );

    const configs = await listModelProviderConfigs(workspaceId);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual(updated);
    expect(configs[0]).toMatchObject({
      defaultThinking: 'medium',
    });
  });

  it('lists only configs for the requested workspace', async () => {
    const otherWorkspaceId = crypto.randomUUID();
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'openai'}),
    );
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId: otherWorkspaceId, providerId: 'google'}),
    );

    const configs = await listModelProviderConfigs(workspaceId);

    expect(configs.map((config) => config.providerId)).toEqual(['anthropic', 'openai']);
  });

  it('updates only the provider default model', async () => {
    const created = await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        providerId: 'anthropic',
        defaultModel: 'claude-opus-4-8',
      }),
    );

    const updated = await updateModelProviderDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });

    expect(updated).toMatchObject({
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: created.defaultThinking,
    });
  });

  it('returns undefined when updating a missing provider default model', async () => {
    const updated = await updateModelProviderDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
    });

    expect(updated).toBeUndefined();
  });

  it('hard-deletes a provider config', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );

    const deleted = await deleteModelProviderConfig({workspaceId, providerId: 'anthropic'});

    const found = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(deleted).toBe(true);
    expect(found).toBeUndefined();
  });

  it('returns false when deleting a missing provider config', async () => {
    const deleted = await deleteModelProviderConfig({workspaceId, providerId: 'anthropic'});

    expect(deleted).toBe(false);
  });

  it('clears the workspace default when the default provider config is deleted', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await setDefaultModelProvider({workspaceId, providerId: 'anthropic'});

    await deleteModelProviderConfig({workspaceId, providerId: 'anthropic'});

    const settings = await getAgentWorkspaceSettings(workspaceId);
    expect(settings?.defaultProviderId).toBeNull();
  });

  it('keeps the workspace default when a non-default provider config is deleted', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'openai'}),
    );
    await setDefaultModelProvider({workspaceId, providerId: 'anthropic'});

    await deleteModelProviderConfig({workspaceId, providerId: 'openai'});

    const settings = await getAgentWorkspaceSettings(workspaceId);
    expect(settings?.defaultProviderId).toBe('anthropic');
  });

  it('round-trips a custom model provider row without storing secret headers in plaintext headers', async () => {
    const created = await upsertModelProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      secretHeaderNames: ['authorization'],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      defaultModel: 'llama-3.1',
      defaultThinking: 'high',
    });

    const found = await getModelProviderConfig({workspaceId, providerId: 'local-vllm'});

    expect(found).toEqual(created);
    expect(found).toMatchObject({
      workspaceId,
      providerId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      secretHeaderNames: ['authorization'],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      defaultModel: 'llama-3.1',
    });
    expect(found?.headers).not.toContainEqual({
      name: 'authorization',
      value: 'Bearer header-secret',
    });
  });

  it('does not clobber custom columns when a later upsert omits them', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      secretHeaderNames: ['authorization'],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      defaultModel: 'llama-3.1',
      defaultThinking: 'high',
    });

    const updated = await upsertModelProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
      defaultModel: null,
      defaultThinking: 'medium',
    });

    expect(updated).toMatchObject({
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      secretHeaderNames: ['authorization'],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      defaultModel: null,
      defaultThinking: 'medium',
    });
  });

  it('keeps custom columns null for built-in rows', async () => {
    const created = await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );

    expect(created).toMatchObject({
      kind: 'builtin',
      displayName: null,
      api: null,
      baseUrl: null,
      headers: null,
      models: null,
    });
  });

  it('rejects custom rows missing required custom fields', async () => {
    const insert = db().insert(modelProviderConfigs).values({
      workspaceId,
      providerId: 'broken-custom',
      kind: 'custom',
      defaultModel: null,
      defaultThinking: 'high',
    });

    await expect(insert).rejects.toThrow();
  });
});

function createModelProviderConfigParams(params: {
  workspaceId: string;
  providerId: SupportedModelProviderId | ModelProviderRef;
  defaultModel?: string | undefined;
  defaultThinking?: AgentThinking | undefined;
}): UpsertModelProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    defaultModel: params.defaultModel ?? 'claude-opus-4-8',
    defaultThinking: params.defaultThinking ?? 'high',
  };
}
