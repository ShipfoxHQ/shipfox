import crypto from 'node:crypto';
import type {AgentThinking, SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {
  getAgentWorkspaceSettings,
  setDefaultModelProvider,
  type UpsertModelProviderConfigParams,
  upsertModelProviderConfig,
} from '#db/index.js';
import {InvalidAgentModelError, UnsupportedModelProviderError} from './errors.js';
import {catalogDefaultAgentResolver, resolveAgentConfig} from './resolve-agent-config.js';
import {createWorkspaceAgentDefaultsResolver} from './workspace-agent-defaults-resolver.js';

describe('resolveAgentConfig', () => {
  test('resolves model provider from explicit step, workspace, instance, then catalog default', () => {
    const workspaceModelProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
      [
        'google' as const,
        {defaultModel: 'gemini-3.1-pro-preview', defaultThinking: 'low' as const},
      ],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'google'},
      {
        workspaceDefaultModelProviderId: 'openai',
        workspaceModelProviderConfigs,
        instanceDefaultModelProvider: 'anthropic',
      },
    );
    const workspace = resolveAgentConfig(
      {},
      {workspaceDefaultModelProviderId: 'openai', workspaceModelProviderConfigs},
    );
    const instance = resolveAgentConfig({}, {instanceDefaultModelProvider: 'anthropic'});
    const catalog = resolveAgentConfig({});

    expect(explicit.provider).toBe('google');
    expect(workspace.provider).toBe('openai');
    expect(instance.provider).toBe('anthropic');
    expect(catalog.provider).toBe('anthropic');
  });

  test('resolves model from explicit step, workspace, instance match, then catalog default', () => {
    const workspaceModelProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
      ['anthropic' as const, {defaultModel: null, defaultThinking: 'low' as const}],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'openai', model: 'gpt-5.5-pro'},
      {workspaceModelProviderConfigs},
    );
    const workspace = resolveAgentConfig({provider: 'openai'}, {workspaceModelProviderConfigs});
    const instance = resolveAgentConfig(
      {},
      {
        instanceDefaultModelProvider: 'anthropic',
        instanceDefaultModelProviderModel: 'claude-opus-4-8',
      },
    );
    const workspaceLatest = resolveAgentConfig(
      {provider: 'anthropic'},
      {workspaceModelProviderConfigs},
    );
    const catalog = resolveAgentConfig({provider: 'deepseek'});

    expect(explicit.model).toBe('gpt-5.5-pro');
    expect(workspace.model).toBe('gpt-5.5-pro');
    expect(instance.model).toBe('claude-opus-4-8');
    expect(workspaceLatest.model).toBe('claude-opus-4-8');
    expect(catalog.model).toBe('deepseek-v4-pro');
  });

  test('uses instance model and thinking only for the resolved instance model provider', () => {
    const resolved = resolveAgentConfig(
      {provider: 'openai'},
      {
        instanceDefaultModelProvider: 'anthropic',
        instanceDefaultModelProviderModel: 'claude-opus-4-8',
        instanceDefaultModelProviderThinking: 'low',
      },
    );

    expect(resolved).toEqual({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'high',
    });
  });

  test('resolves thinking from explicit step, workspace, instance match, then default', () => {
    const workspaceModelProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'openai', thinking: 'low'},
      {workspaceModelProviderConfigs},
    );
    const workspace = resolveAgentConfig({provider: 'openai'}, {workspaceModelProviderConfigs});
    const instance = resolveAgentConfig(
      {},
      {instanceDefaultModelProvider: 'anthropic', instanceDefaultModelProviderThinking: 'medium'},
    );
    const fallback = resolveAgentConfig({provider: 'deepseek'});

    expect(explicit.thinking).toBe('low');
    expect(workspace.thinking).toBe('medium');
    expect(instance.thinking).toBe('medium');
    expect(fallback.thinking).toBe('high');
  });

  test('throws for unsupported providers and unavailable models', () => {
    expect(() => resolveAgentConfig({provider: 'amazon-bedrock'})).toThrow(
      UnsupportedModelProviderError,
    );
    expect(() => resolveAgentConfig({provider: 'anthropic', model: 'not-a-model'})).toThrow(
      InvalidAgentModelError,
    );
  });

  test('falls through to the instance default when the workspace default model provider is null', () => {
    const resolved = resolveAgentConfig(
      {},
      {workspaceDefaultModelProviderId: null, instanceDefaultModelProvider: 'anthropic'},
    );

    expect(resolved.provider).toBe('anthropic');
  });

  test('throws when a stored workspace default model provider is no longer supported', () => {
    const resolve = () =>
      resolveAgentConfig(
        {},
        {workspaceDefaultModelProviderId: 'amazon-bedrock' as SupportedModelProviderId},
      );

    expect(resolve).toThrow(UnsupportedModelProviderError);
  });

  test('validates the instance default model and rejects an unknown one', () => {
    const resolve = () =>
      resolveAgentConfig(
        {},
        {
          instanceDefaultModelProvider: 'anthropic',
          instanceDefaultModelProviderModel: 'not-a-model',
        },
      );

    expect(resolve).toThrow(InvalidAgentModelError);
  });

  test('catalogDefaultAgentResolver uses catalog-only defaults', () => {
    const resolved = catalogDefaultAgentResolver({provider: 'openai'});

    expect(resolved).toEqual({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'high',
    });
  });
});

describe('createWorkspaceAgentDefaultsResolver', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  test('preloads workspace settings and model provider configs for resolution', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        modelProviderId: 'openai',
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );
    await setDefaultModelProvider({workspaceId, modelProviderId: 'openai'});

    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);
    const resolved = resolver({});
    const settings = await getAgentWorkspaceSettings(workspaceId);

    expect(settings?.defaultModelProviderId).toBe('openai');
    expect(resolved).toEqual({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
    });
  });

  test('falls back to catalog defaults when no workspace settings exist', async () => {
    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);

    const resolved = resolver({});

    expect(resolved).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });
  });

  test('uses workspace model provider config defaults when settings row does not exist', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        modelProviderId: 'openai',
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );

    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);
    const resolved = resolver({provider: 'openai'});

    expect(resolved).toEqual({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
    });
  });

  test('uses catalog model when the workspace model provider config keeps latest selected', async () => {
    await upsertModelProviderConfig(
      createModelProviderConfigParams({
        workspaceId,
        modelProviderId: 'openai',
        defaultModel: null,
        defaultThinking: 'medium',
      }),
    );

    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);
    const resolved = resolver({provider: 'openai'});

    expect(resolved).toEqual({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'medium',
    });
  });
});

function createModelProviderConfigParams(params: {
  workspaceId: string;
  modelProviderId: SupportedModelProviderId;
  defaultModel: string | null;
  defaultThinking: AgentThinking;
}): UpsertModelProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    modelProviderId: params.modelProviderId,
    encryptedCredentials: {'credential:api_key': `encrypted-${params.modelProviderId}-key`},
    keyFingerprints: {'credential:api_key': 'sk-test...abcd'},
    defaultModel: params.defaultModel,
    defaultThinking: params.defaultThinking,
  };
}
