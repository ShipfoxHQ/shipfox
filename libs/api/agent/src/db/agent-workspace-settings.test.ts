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
      createModelProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );

    const settings = await setDefaultModelProvider({workspaceId, providerId: 'anthropic'});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found).toEqual(settings);
    expect(found).toMatchObject({
      workspaceId,
      defaultProviderId: 'anthropic',
    });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it('updates the workspace default model provider', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'openai'}),
    );
    await setDefaultModelProvider({workspaceId, providerId: 'anthropic'});

    const updated = await setDefaultModelProvider({workspaceId, providerId: 'openai'});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found).toEqual(updated);
    expect(found?.defaultProviderId).toBe('openai');
  });

  it('clears the workspace default model provider', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await setDefaultModelProvider({workspaceId, providerId: 'anthropic'});

    await setDefaultModelProvider({workspaceId, providerId: null});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found?.defaultProviderId).toBeNull();
  });

  it('returns undefined for a workspace without settings', async () => {
    const found = await getAgentWorkspaceSettings(workspaceId);

    expect(found).toBeUndefined();
  });

  it('rejects a default model provider without a matching config', async () => {
    const result = setDefaultModelProvider({workspaceId, providerId: 'anthropic'});

    await expect(result).rejects.toBeInstanceOf(ModelProviderConfigNotFoundError);
  });
});

function createModelProviderConfigParams(params: {
  workspaceId: string;
  providerId: SupportedModelProviderId;
  defaultThinking?: AgentThinking | undefined;
}): UpsertModelProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    defaultModel: 'claude-opus-4-8',
    defaultThinking: params.defaultThinking ?? 'high',
  };
}
