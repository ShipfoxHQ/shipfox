import type {SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {deleteModelProviderConfig, upsertModelProviderConfig} from '#db/index.js';
import {encryptCredentials} from './credential-encryption.js';
import {CredentialDecryptionError, ModelProviderConfigNotFoundError} from './errors.js';
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
      instanceConfig(),
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
      instanceConfig(),
    );
    const mismatched = resolveRuntimeCredentials(
      {
        workspaceId,
        provider: 'openai',
        model: 'gpt-5.5-pro',
        thinking: 'high',
      },
      instanceConfig(),
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

  it('does not expose credential material on corrupt ciphertext errors', async () => {
    const plaintext = 'sk-workspace-secret';
    const encryptedCredentials = encryptCredentials({
      workspaceId,
      providerId: 'anthropic',
      credentials: {api_key: plaintext},
    });
    const encrypted = encryptedCredentials['credential:api_key'] as string;
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      encryptedCredentials: {'credential:api_key': `${encrypted.slice(0, -2)}AA`},
      keyFingerprints: {'credential:api_key': 'sk-work...cret'},
      defaultModel: null,
      defaultThinking: 'high',
    });

    const result = resolveRuntimeCredentials({
      workspaceId,
      provider: 'anthropic',
      model: 'claude-opus-4-8',
      thinking: 'high',
    });

    await expect(result).rejects.toThrow(CredentialDecryptionError);
    try {
      await result;
    } catch (error) {
      expect(String(error)).not.toContain(plaintext);
      expect(String(error)).not.toContain(encrypted);
    }
  });
});

async function saveProviderConfig(params: {
  workspaceId: string;
  providerId: SupportedModelProviderId;
  credentials: Record<string, string>;
}) {
  return await upsertModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    encryptedCredentials: encryptCredentials(params),
    keyFingerprints: {'credential:api_key': 'sk-test...cret'},
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
