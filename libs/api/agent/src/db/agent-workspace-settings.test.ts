import crypto from 'node:crypto';
import type {AgentThinking, SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {ModelProviderConfigNotFoundError} from '#core/index.js';
import {getAgentWorkspaceSettings, setDefaultModelProvider} from '#db/index.js';
import {
  type UpsertModelProviderConfigParams,
  upsertModelProviderConfig,
} from './model-provider-configs.js';

describe('agent workspace settings', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('persists the workspace default model provider', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'}),
    );

    const settings = await setDefaultModelProvider({workspaceId, modelProviderId: 'anthropic'});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found).toEqual(settings);
    expect(found).toMatchObject({
      workspaceId,
      defaultModelProviderId: 'anthropic',
    });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it('updates the workspace default model provider', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'}),
    );
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'openai'}),
    );
    await setDefaultModelProvider({workspaceId, modelProviderId: 'anthropic'});

    const updated = await setDefaultModelProvider({workspaceId, modelProviderId: 'openai'});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found).toEqual(updated);
    expect(found?.defaultModelProviderId).toBe('openai');
  });

  it('clears the workspace default model provider', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, modelProviderId: 'anthropic'}),
    );
    await setDefaultModelProvider({workspaceId, modelProviderId: 'anthropic'});

    await setDefaultModelProvider({workspaceId, modelProviderId: null});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found?.defaultModelProviderId).toBeNull();
  });

  it('returns undefined for a workspace without settings', async () => {
    const found = await getAgentWorkspaceSettings(workspaceId);

    expect(found).toBeUndefined();
  });

  it('rejects a default model provider without a matching config', async () => {
    const result = setDefaultModelProvider({workspaceId, modelProviderId: 'anthropic'});

    await expect(result).rejects.toBeInstanceOf(ModelProviderConfigNotFoundError);
  });
});

function createModelProviderConfigParams(params: {
  workspaceId: string;
  modelProviderId: SupportedModelProviderId;
  defaultThinking?: AgentThinking | undefined;
}): UpsertModelProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    modelProviderId: params.modelProviderId,
    encryptedCredentials: {'credential:api_key': `encrypted-${params.modelProviderId}-key`},
    keyFingerprints: {'credential:api_key': 'sk-ant-...abcd'},
    defaultModel: 'claude-opus-4-8',
    defaultThinking: params.defaultThinking ?? 'high',
  };
}
