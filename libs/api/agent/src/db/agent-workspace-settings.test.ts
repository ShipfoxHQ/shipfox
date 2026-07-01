import crypto from 'node:crypto';
import type {AgentThinking, SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {AgentProviderConfigNotFoundError} from '#core/index.js';
import {getAgentWorkspaceSettings, setDefaultAgentProvider} from '#db/index.js';
import {
  type UpsertAgentProviderConfigParams,
  upsertAgentProviderConfig,
} from './agent-provider-configs.js';

describe('agent workspace settings', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('persists the workspace default provider', async () => {
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );

    const settings = await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found).toEqual(settings);
    expect(found).toMatchObject({
      workspaceId,
      defaultProviderId: 'anthropic',
    });
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.updatedAt).toBeInstanceOf(Date);
  });

  it('updates the workspace default provider', async () => {
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'openai'}),
    );
    await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    const updated = await setDefaultAgentProvider({workspaceId, providerId: 'openai'});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found).toEqual(updated);
    expect(found?.defaultProviderId).toBe('openai');
  });

  it('clears the workspace default provider', async () => {
    await upsertAgentProviderConfig(
      createProviderConfigParams({workspaceId, providerId: 'anthropic'}),
    );
    await setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    await setDefaultAgentProvider({workspaceId, providerId: null});

    const found = await getAgentWorkspaceSettings(workspaceId);
    expect(found?.defaultProviderId).toBeNull();
  });

  it('returns undefined for a workspace without settings', async () => {
    const found = await getAgentWorkspaceSettings(workspaceId);

    expect(found).toBeUndefined();
  });

  it('rejects a default provider without a matching config', async () => {
    const result = setDefaultAgentProvider({workspaceId, providerId: 'anthropic'});

    await expect(result).rejects.toBeInstanceOf(AgentProviderConfigNotFoundError);
  });
});

function createProviderConfigParams(params: {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  defaultThinking?: AgentThinking | undefined;
}): UpsertAgentProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    encryptedCredentials: {'credential:api_key': `encrypted-${params.providerId}-key`},
    keyFingerprints: {'credential:api_key': 'sk-ant-...abcd'},
    defaultModel: 'claude-opus-4-8',
    defaultThinking: params.defaultThinking ?? 'high',
  };
}
