import crypto from 'node:crypto';
import type {AgentThinking, SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {
  deleteAgentProviderConfig,
  getAgentProviderConfig,
  getAgentWorkspaceSettings,
  listAgentProviderConfigs,
  setDefaultAgentProvider,
  type UpsertAgentProviderConfigParams,
  updateAgentProviderDefaultModel,
  upsertAgentProviderConfig,
} from '#db/index.js';

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
      encryptedCredentials: {api_key: 'encrypted-anthropic-key'},
      keyFingerprints: {api_key: 'sk-ant-...abcd'},
      defaultModel: 'claude-opus-4-8',
      defaultThinking: 'high',
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
        encryptedCredentials: {api_key: 'encrypted-rotated-key'},
        keyFingerprints: {api_key: 'sk-openai-...wxyz'},
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );

    const configs = await listAgentProviderConfigs(workspaceId);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toEqual(updated);
    expect(configs[0]).toMatchObject({
      encryptedCredentials: {api_key: 'encrypted-rotated-key'},
      keyFingerprints: {api_key: 'sk-openai-...wxyz'},
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
});

function createProviderConfigParams(params: {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  encryptedCredentials?: Record<string, string> | undefined;
  keyFingerprints?: Record<string, string> | undefined;
  defaultModel?: string | undefined;
  defaultThinking?: AgentThinking | undefined;
}): UpsertAgentProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    encryptedCredentials: params.encryptedCredentials ?? {
      api_key: `encrypted-${params.providerId}-key`,
    },
    keyFingerprints: params.keyFingerprints ?? {api_key: 'sk-ant-...abcd'},
    defaultModel: params.defaultModel ?? 'claude-opus-4-8',
    defaultThinking: params.defaultThinking ?? 'high',
  };
}
