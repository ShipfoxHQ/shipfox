import crypto from 'node:crypto';
import type {
  AgentProviderRef,
  AgentThinking,
  SupportedAgentProviderId,
} from '@shipfox/api-agent-dto';
import {decryptCredentials, encryptCredentials} from '#core/credential-encryption.js';
import {
  db,
  deleteAgentProviderConfig,
  getAgentProviderConfig,
  getAgentWorkspaceSettings,
  listAgentProviderConfigs,
  setDefaultAgentProvider,
  type UpsertAgentProviderConfigParams,
  updateAgentProviderDefaultModel,
  upsertAgentProviderConfig,
} from '#db/index.js';
import {agentProviderConfigs} from './schema/agent-provider-configs.js';

describe('agent provider configs', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('persists a provider config for a workspace provider pair', async () => {
    const params = createProviderConfigParams({workspaceId, providerId: 'anthropic'});

    const created = await upsertAgentProviderConfig(params);

    const found = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(found).toEqual(created);
    expect(found).toMatchObject({
      workspaceId,
      providerId: 'anthropic',
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
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'openai'}),
    );

    const updated = await upsertAgentProviderConfig(
      createProviderConfigParams({
        workspaceId,
        providerId: 'openai',
        encryptedCredentials: {'credential:api_key': 'encrypted-rotated-key'},
        keyFingerprints: {'credential:api_key': 'sk-openai-...wxyz'},
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );

    const configs = await listAgentProviderConfigs(workspaceId);
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
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'openai'}),
    );
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId: otherWorkspaceId, providerId: 'google'}),
    );

    const configs = await listAgentProviderConfigs(workspaceId);

    expect(configs.map((config) => config.providerId)).toEqual(['anthropic', 'openai']);
  });

  it('updates only the provider default model', async () => {
    const created = await upsertAgentProviderConfig(
      createProviderConfigParams({
        workspaceId,
        providerId: 'anthropic',
        defaultModel: 'claude-opus-4-8',
      }),
    );

    const updated = await updateAgentProviderDefaultModel({
      workspaceId,
      providerId: 'anthropic',
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
    const updated = await updateAgentProviderDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
    });

    expect(updated).toBeUndefined();
  });

  it('hard-deletes a provider config', async () => {
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );

    const deleted = await deleteAgentProviderConfig({workspaceId, providerId: 'anthropic'});

    const found = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(deleted).toBe(true);
    expect(found).toBeUndefined();
  });

  it('returns false when deleting a missing provider config', async () => {
    const deleted = await deleteAgentProviderConfig({workspaceId, providerId: 'anthropic'});

    expect(deleted).toBe(false);
  });

  it('clears the workspace default when the default provider config is deleted', async () => {
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    await deleteAgentProviderConfig({workspaceId, providerId: 'anthropic'});

    const settings = await getAgentWorkspaceSettings(workspaceId);
    expect(settings?.defaultProviderId).toBeNull();
  });

  it('keeps the workspace default when a non-default provider config is deleted', async () => {
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'openai'}),
    );
    await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    await deleteAgentProviderConfig({workspaceId, providerId: 'openai'});

    const settings = await getAgentWorkspaceSettings(workspaceId);
    expect(settings?.defaultProviderId).toBe('anthropic');
  });

  it('round-trips a custom provider row without storing secret headers in plaintext headers', async () => {
    const encryptedCredentials = encryptCredentials({
      workspaceId,
      providerId: 'local-vllm',
      credentials: {
        api_key: 'sk-local-secret',
        'header:authorization': 'Bearer header-secret',
      },
    });

    const created = await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
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

    const found = await getAgentProviderConfig({workspaceId, providerId: 'local-vllm'});
    const decrypted = decryptCredentials({
      workspaceId,
      providerId: 'local-vllm',
      encryptedCredentials: found?.encryptedCredentials ?? {},
    });

    expect(found).toEqual(created);
    expect(found).toMatchObject({
      workspaceId,
      providerId: 'local-vllm',
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
    await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
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

    const updated = await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'local-vllm',
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
    const created = await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'anthropic'}),
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
    const insert = db().insert(agentProviderConfigs).values({
      workspaceId,
      providerId: 'broken-custom',
      kind: 'custom',
      encryptedCredentials: {},
      keyFingerprints: {},
      defaultModel: null,
      defaultThinking: 'high',
    });

    await expect(insert).rejects.toThrow();
  });
});

function createProviderConfigParams(params: {
  workspaceId: string;
  providerId: SupportedAgentProviderId | AgentProviderRef;
  encryptedCredentials?: Record<string, string> | undefined;
  keyFingerprints?: Record<string, string> | undefined;
  defaultModel?: string | undefined;
  defaultThinking?: AgentThinking | undefined;
}): UpsertAgentProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    encryptedCredentials: params.encryptedCredentials ?? {
      'credential:api_key': `encrypted-${params.providerId}-key`,
    },
    keyFingerprints: params.keyFingerprints ?? {'credential:api_key': 'sk-ant-...abcd'},
    defaultModel: params.defaultModel ?? 'claude-opus-4-8',
    defaultThinking: params.defaultThinking ?? 'high',
  };
}
