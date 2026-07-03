import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {SecretDecryptionError, setSecrets} from '@shipfox/api-secrets';
import {deleteModelProviderConfig, upsertModelProviderConfig} from '#db/index.js';
import {agentSystemNamespace} from './credential-fingerprints.js';
import {ModelProviderConfigNotFoundError} from './errors.js';
import {resolveRuntimeCredentials} from './resolve-runtime-credentials.js';

describe('resolveRuntimeCredentials', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  it('returns decrypted workspace credentials', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: 'sk-workspace-secret'},
    });

    const result = await resolveRuntimeCredentials({
      workspaceId,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    expect(result).toEqual({
      provider_id: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
      credentials: {api_key: 'sk-workspace-secret'},
    });
  });

  it('prefers workspace credentials over the instance fallback', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: 'sk-workspace-secret'},
    });
    const result = await resolveRuntimeCredentials(
      {
        workspaceId,
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      {runtimeConfig: instanceConfig()},
    );

    expect(result.credentials).toEqual({api_key: 'sk-workspace-secret'});
  });

  it('returns the instance fallback only for the instance default model provider', async () => {
    const matching = await resolveRuntimeCredentials(
      {
        workspaceId,
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      {runtimeConfig: instanceConfig()},
    );
    const mismatched = resolveRuntimeCredentials(
      {
        workspaceId,
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'high',
      },
      {runtimeConfig: instanceConfig()},
    );

    expect(matching.credentials).toEqual({api_key: 'sk-instance-secret'});
    await expect(mismatched).rejects.toMatchObject({name: 'ModelProviderConfigNotFoundError'});
  });

  it('throws when no workspace or instance credential is available', async () => {
    const result = resolveRuntimeCredentials({
      workspaceId,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('throws after a workspace credential is deleted', async () => {
    await saveProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: 'sk-workspace-secret'},
    });
    await deleteModelProviderConfig({workspaceId, providerId: 'anthropic'});

    const result = resolveRuntimeCredentials({
      workspaceId,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('throws when a configured row has no secret bag', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      keyFingerprints: {'credential:api_key': '...cret'},
      defaultModel: null,
      defaultThinking: 'high',
    });

    const result = resolveRuntimeCredentials({
      workspaceId,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('does not resolve an orphaned secret without a provider config row', async () => {
    await setSecrets({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
      values: {API_KEY: 'sk-orphaned-secret'},
    });

    const result = resolveRuntimeCredentials({
      workspaceId,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('does not expose credential material on store decryption errors', async () => {
    const error = new SecretDecryptionError();
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      keyFingerprints: {'credential:api_key': '...cret'},
      defaultModel: null,
      defaultThinking: 'high',
    });

    const result = resolveRuntimeCredentials(
      {
        workspaceId,
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        thinking: 'high',
      },
      {getCredentialBag: vi.fn().mockRejectedValue(error)},
    );

    await expect(result).rejects.toThrow(SecretDecryptionError);
    try {
      await result;
    } catch (error) {
      expect(String(error)).not.toContain('sk-workspace-secret');
    }
  });
});

async function saveProviderConfig(params: {
  workspaceId: string;
  providerId: SupportedModelProviderId;
  credentials: {api_key: string};
}) {
  await setSecrets({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.providerId),
    values: {API_KEY: params.credentials.api_key},
  });
  return await upsertModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    keyFingerprints: {'credential:api_key': '...cret'},
    defaultModel: null,
    defaultThinking: 'high',
  });
}

function instanceConfig() {
  return {
    AGENT_DEFAULT_PROVIDER: 'anthropic' as const,
    AGENT_DEFAULT_PROVIDER_API_KEY: 'sk-instance-secret',
  };
}
