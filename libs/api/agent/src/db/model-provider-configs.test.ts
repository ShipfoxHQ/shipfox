import crypto from 'node:crypto';
import type {
  AgentThinking,
  ModelProviderRef,
  SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {decryptCredentials, encryptCredentials} from '#core/credential-encryption.js';
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
    const params = createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'});

    const created = await upsertModelProviderConfig(params);

    const found = await getModelProviderConfig({workspaceId, modelProviderId: 'anthropic'});
    expect(found).toEqual(created);
    expect(found).toMatchObject({
      workspaceId,
      modelProviderId: 'anthropic',
      encryptedCredentials: {'credential:api_key': 'encrypted-anthropic-key'},
      keyFingerprints: {'credential:api_key': 'sk-ant-...abcd'},
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
      createModelProviderConfigParams({workspaceId, modelProviderId: 'openai'}),
    );

    const updated = await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        modelProviderId: 'openai',
        encryptedCredentials: {'credential:api_key': 'encrypted-rotated-key'},
        keyFingerprints: {'credential:api_key': 'sk-openai-...wxyz'},
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );

    const configs = await listModelProviderConfigs(workspaceId);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual(updated);
    expect(configs[0]).toMatchObject({
      encryptedCredentials: {'credential:api_key': 'encrypted-rotated-key'},
      keyFingerprints: {'credential:api_key': 'sk-openai-...wxyz'},
      defaultThinking: 'medium',
    });
  });

  it('lists only configs for the requested workspace', async () => {
    const otherWorkspaceId = crypto.randomUUID();
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'openai'}),
    );
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'}),
    );
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId: otherWorkspaceId, modelProviderId: 'google'}),
    );

    const configs = await listModelProviderConfigs(workspaceId);

    expect(configs.map((config) => config.modelProviderId)).toEqual(['anthropic', 'openai']);
  });

  it('updates only the provider default model', async () => {
    const created = await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        modelProviderId: 'anthropic',
        defaultModel: 'claude-opus-4-8',
      }),
    );

    const updated = await updateModelProviderDefaultModel({
      workspaceId,
      modelProviderId: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });

    expect(updated).toMatchObject({
      encryptedCredentials: created.encryptedCredentials,
      keyFingerprints: created.keyFingerprints,
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: created.defaultThinking,
    });
  });

  it('returns undefined when updating a missing provider default model', async () => {
    const updated = await updateModelProviderDefaultModel({
      workspaceId,
      modelProviderId: 'anthropic',
      defaultModel: null,
    });

    expect(updated).toBeUndefined();
  });

  it('hard-deletes a provider config', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'}),
    );

    const deleted = await deleteModelProviderConfig({workspaceId, modelProviderId: 'anthropic'});

    const found = await getModelProviderConfig({workspaceId, modelProviderId: 'anthropic'});
    expect(deleted).toBe(true);
    expect(found).toBeUndefined();
  });

  it('returns false when deleting a missing provider config', async () => {
    const deleted = await deleteModelProviderConfig({workspaceId, modelProviderId: 'anthropic'});

    expect(deleted).toBe(false);
  });

  it('clears the workspace default when the default provider config is deleted', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'}),
    );
    await setDefaultModelProvider({workspaceId, modelProviderId: 'anthropic'});

    await deleteModelProviderConfig({workspaceId, modelProviderId: 'anthropic'});

    const settings = await getAgentWorkspaceSettings(workspaceId);
    expect(settings?.defaultModelProviderId).toBeNull();
  });

  it('keeps the workspace default when a non-default provider config is deleted', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'}),
    );
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'openai'}),
    );
    await setDefaultModelProvider({workspaceId, modelProviderId: 'anthropic'});

    await deleteModelProviderConfig({workspaceId, modelProviderId: 'openai'});

    const settings = await getAgentWorkspaceSettings(workspaceId);
    expect(settings?.defaultModelProviderId).toBe('anthropic');
  });

  it('round-trips a custom model provider row without storing secret headers in plaintext headers', async () => {
    const encryptedCredentials = encryptCredentials({
      workspaceId,
      modelProviderId: 'local-vllm',
      credentials: {
        api_key: 'sk-local-secret',
        'header:authorization': 'Bearer header-secret',
      },
    });

    const created = await upsertModelProviderConfig({
      workspaceId,
      modelProviderId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      encryptedCredentials,
      keyFingerprints: {
        'credential:api_key': 'sk-local...cret',
        'header:authorization': 'Bearer ...cret',
      },
      defaultModel: 'llama-3.1',
      defaultThinking: 'high',
    });

    const found = await getModelProviderConfig({workspaceId, modelProviderId: 'local-vllm'});
    const decrypted = decryptCredentials({
      workspaceId,
      modelProviderId: 'local-vllm',
      encryptedCredentials: found?.encryptedCredentials ?? {},
    });

    expect(found).toEqual(created);
    expect(found).toMatchObject({
      workspaceId,
      modelProviderId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      defaultModel: 'llama-3.1',
    });
    expect(found?.headers).not.toContainEqual({
      name: 'authorization',
      value: 'Bearer header-secret',
    });
    expect(Object.keys(found?.encryptedCredentials ?? {})).toEqual([
      'credential:api_key',
      'header:authorization',
    ]);
    expect(found?.keyFingerprints['header:authorization']).toBe('Bearer ...cret');
    expect(decrypted).toEqual({
      api_key: 'sk-local-secret',
      'header:authorization': 'Bearer header-secret',
    });
  });

  it('does not clobber custom columns when a later upsert omits them', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      modelProviderId: 'local-vllm',
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      encryptedCredentials: {'credential:api_key': 'encrypted-local-key'},
      keyFingerprints: {'credential:api_key': 'sk-local...abcd'},
      defaultModel: 'llama-3.1',
      defaultThinking: 'high',
    });

    const updated = await upsertModelProviderConfig({
      workspaceId,
      modelProviderId: 'local-vllm',
      encryptedCredentials: {'credential:api_key': 'encrypted-rotated-key'},
      keyFingerprints: {'credential:api_key': 'sk-rotat...abcd'},
      defaultModel: null,
      defaultThinking: 'medium',
    });

    expect(updated).toMatchObject({
      kind: 'custom',
      displayName: 'Local vLLM',
      api: 'openai-responses',
      baseUrl: 'https://llm.example.test/v1',
      headers: [{name: 'x-region', value: 'local'}],
      models: [{id: 'llama-3.1', label: 'Llama 3.1'}],
      encryptedCredentials: {'credential:api_key': 'encrypted-rotated-key'},
      defaultModel: null,
      defaultThinking: 'medium',
    });
  });

  it('keeps custom columns null for built-in rows', async () => {
    const created = await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'}),
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
      modelProviderId: 'broken-custom',
      kind: 'custom',
      encryptedCredentials: {},
      keyFingerprints: {},
      defaultModel: null,
      defaultThinking: 'high',
    });

    await expect(insert).rejects.toThrow();
  });
});

function createModelProviderConfigParams(params: {
  workspaceId: string;
  modelProviderId: SupportedModelProviderId | ModelProviderRef;
  encryptedCredentials?: Record<string, string> | undefined;
  keyFingerprints?: Record<string, string> | undefined;
  defaultModel?: string | undefined;
  defaultThinking?: AgentThinking | undefined;
}): UpsertModelProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    modelProviderId: params.modelProviderId,
    encryptedCredentials: params.encryptedCredentials ?? {
      'credential:api_key': `encrypted-${params.modelProviderId}-key`,
    },
    keyFingerprints: params.keyFingerprints ?? {'credential:api_key': 'sk-ant-...abcd'},
    defaultModel: params.defaultModel ?? 'claude-opus-4-8',
    defaultThinking: params.defaultThinking ?? 'high',
  };
}
