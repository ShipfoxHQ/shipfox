import crypto from 'node:crypto';
import type {AgentThinking, SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {
  getAgentWorkspaceSettings,
  setDefaultAgentProvider,
  type UpsertAgentProviderConfigParams,
  upsertAgentProviderConfig,
} from '#db/index.js';
import {InvalidAgentModelError, UnsupportedAgentProviderError} from './errors.js';
import {
  catalogDefaultAgentResolver,
  createWorkspaceAgentDefaultsResolver,
  resolveAgentConfig,
} from './resolve-agent-config.js';

describe('resolveAgentConfig', () => {
  test('resolves provider from explicit step, workspace, instance, then catalog default', () => {
    const workspaceProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
      [
        'google' as const,
        {defaultModel: 'gemini-3.1-pro-preview', defaultThinking: 'low' as const},
      ],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'google'},
      {
        workspaceDefaultProviderId: 'openai',
        workspaceProviderConfigs,
        instanceDefaultProvider: 'anthropic',
      },
    );
    const workspace = resolveAgentConfig(
      {},
      {workspaceDefaultProviderId: 'openai', workspaceProviderConfigs},
    );
    const instance = resolveAgentConfig({}, {instanceDefaultProvider: 'anthropic'});
    const catalog = resolveAgentConfig({});

    expect(explicit.provider).toBe('google');
    expect(workspace.provider).toBe('openai');
    expect(instance.provider).toBe('anthropic');
    expect(catalog.provider).toBe('anthropic');
  });

  test('resolves model from explicit step, workspace, instance match, then catalog default', () => {
    const workspaceProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'openai', model: 'gpt-5.5-pro'},
      {workspaceProviderConfigs},
    );
    const workspace = resolveAgentConfig({provider: 'openai'}, {workspaceProviderConfigs});
    const instance = resolveAgentConfig(
      {},
      {
        instanceDefaultProvider: 'anthropic',
        instanceDefaultProviderModel: 'claude-opus-4-8',
      },
    );
    const catalog = resolveAgentConfig({provider: 'deepseek'});

    expect(explicit.model).toBe('gpt-5.5-pro');
    expect(workspace.model).toBe('gpt-5.5-pro');
    expect(instance.model).toBe('claude-opus-4-8');
    expect(catalog.model).toBe('deepseek-v4-pro');
  });

  test('uses instance model and thinking only for the resolved instance provider', () => {
    const resolved = resolveAgentConfig(
      {provider: 'openai'},
      {
        instanceDefaultProvider: 'anthropic',
        instanceDefaultProviderModel: 'claude-opus-4-8',
        instanceDefaultProviderThinking: 'low',
      },
    );

    expect(resolved).toEqual({
      provider: 'openai',
      model: 'gpt-5.5-pro',
      thinking: 'high',
    });
  });

  test('resolves thinking from explicit step, workspace, instance match, then default', () => {
    const workspaceProviderConfigs = new Map([
      ['openai' as const, {defaultModel: 'gpt-5.5-pro', defaultThinking: 'medium' as const}],
    ]);

    const explicit = resolveAgentConfig(
      {provider: 'openai', thinking: 'low'},
      {workspaceProviderConfigs},
    );
    const workspace = resolveAgentConfig({provider: 'openai'}, {workspaceProviderConfigs});
    const instance = resolveAgentConfig(
      {},
      {instanceDefaultProvider: 'anthropic', instanceDefaultProviderThinking: 'medium'},
    );
    const fallback = resolveAgentConfig({provider: 'deepseek'});

    expect(explicit.thinking).toBe('low');
    expect(workspace.thinking).toBe('medium');
    expect(instance.thinking).toBe('medium');
    expect(fallback.thinking).toBe('high');
  });

  test('throws for unsupported providers and unavailable models', () => {
    expect(() => resolveAgentConfig({provider: 'amazon-bedrock'})).toThrow(
      UnsupportedAgentProviderError,
    );
    expect(() => resolveAgentConfig({provider: 'anthropic', model: 'not-a-model'})).toThrow(
      InvalidAgentModelError,
    );
  });

  test('falls through to the instance default when the workspace default provider is null', () => {
    const resolved = resolveAgentConfig(
      {},
      {workspaceDefaultProviderId: null, instanceDefaultProvider: 'anthropic'},
    );

    expect(resolved.provider).toBe('anthropic');
  });

  test('throws when a stored workspace default provider is no longer supported', () => {
    const resolve = () =>
      resolveAgentConfig(
        {},
        {workspaceDefaultProviderId: 'amazon-bedrock' as SupportedAgentProviderId},
      );

    expect(resolve).toThrow(UnsupportedAgentProviderError);
  });

  test('validates the instance default model and rejects an unknown one', () => {
    const resolve = () =>
      resolveAgentConfig(
        {},
        {instanceDefaultProvider: 'anthropic', instanceDefaultProviderModel: 'not-a-model'},
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

  test('preloads workspace settings and provider configs for resolution', async () => {
    await upsertAgentProviderConfig(
      createProviderConfigParams({
        workspaceId,
        providerId: 'openai',
        defaultModel: 'gpt-5.5-pro',
        defaultThinking: 'medium',
      }),
    );
    await setDefaultAgentProvider({workspaceId, providerId: 'openai'});

    const resolver = await createWorkspaceAgentDefaultsResolver(workspaceId);
    const resolved = resolver({});
    const settings = await getAgentWorkspaceSettings(workspaceId);

    expect(settings?.defaultProviderId).toBe('openai');
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
});

function createProviderConfigParams(params: {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  defaultModel: string;
  defaultThinking: AgentThinking;
}): UpsertAgentProviderConfigParams {
  return {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    encryptedCredentials: {api_key: `encrypted-${params.providerId}-key`},
    keyFingerprints: {api_key: 'sk-test...abcd'},
    defaultModel: params.defaultModel,
    defaultThinking: params.defaultThinking,
  };
}
