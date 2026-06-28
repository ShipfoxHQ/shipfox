import crypto from 'node:crypto';
import {getAgentProviderConfig, upsertAgentProviderConfig} from '#db/index.js';
import {decryptCredentials} from './credential-encryption.js';
import {
  AgentProviderValidationError,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
} from './errors.js';
import {testAndSaveProviderConfig} from './provider-config-service.js';

describe('testAndSaveProviderConfig', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('validates, encrypts, fingerprints, and stores a provider config', async () => {
    const credentials = {api_key: 'sk-ant-secret-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials},
      {probe},
    );

    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.encryptedCredentials).not.toEqual(credentials);
    expect(stored?.encryptedCredentials.api_key).not.toContain(credentials.api_key);
    expect(
      decryptCredentials({
        workspaceId,
        providerId: 'anthropic',
        encryptedCredentials: stored?.encryptedCredentials ?? {},
      }),
    ).toEqual(credentials);
    expect(stored?.keyFingerprints).toEqual({api_key: 'sk-ant-s...abcd'});
    expect(stored?.defaultModel).toBe('claude-opus-4-8');
    expect(stored?.defaultThinking).toBe('high');
  });

  it('does not persist when provider validation fails and sanitizes the surfaced error', async () => {
    const secret = 'sk-ant-secret-abcd';
    const base64Secret = Buffer.from(secret, 'utf8').toString('base64');
    const probe = vi
      .fn()
      .mockRejectedValue(new Error(`Provider rejected ${secret} and ${base64Secret}`));

    const save = testAndSaveProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: secret}},
      {probe},
    );

    await expect(save).rejects.toThrow(AgentProviderValidationError);
    await expect(save).rejects.not.toThrow(secret);
    await expect(save).rejects.not.toThrow(base64Secret);
    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('sanitizes non-Error probe failures and persists nothing', async () => {
    const probe = vi.fn().mockRejectedValue('raw thrown value');

    const save = testAndSaveProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow('Provider validation failed.');
    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('leaves an existing row unchanged when credential rotation validation fails', async () => {
    const existing = await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      encryptedCredentials: {api_key: 'already-encrypted'},
      keyFingerprints: {api_key: 'sk-old...abcd'},
      defaultModel: 'claude-opus-4-8',
      defaultThinking: 'high',
    });
    const probe = vi.fn().mockRejectedValue(new Error('bad key'));

    const save = testAndSaveProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-new-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow(AgentProviderValidationError);
    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toEqual(existing);
  });

  it('propagates InvalidAgentModelError and persists nothing', async () => {
    const error = new InvalidAgentModelError('anthropic', 'claude-opus-4-8');
    const probe = vi.fn().mockRejectedValue(error);

    const save = testAndSaveProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toBe(error);
    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('validates and stores Azure provider configs with multi-field credentials', async () => {
    const probe = vi.fn();
    const credentials = {
      endpoint: 'https://azure.example.test/openai/v1',
      api_key: 'sk-azure-secret-abcd',
    };

    const config = await testAndSaveProviderConfig(
      {
        workspaceId,
        providerId: 'azure-openai-responses',
        credentials,
      },
      {probe},
    );

    const stored = await getAgentProviderConfig({
      workspaceId,
      providerId: 'azure-openai-responses',
    });
    expect(stored).toEqual(config);
    expect(
      decryptCredentials({
        workspaceId,
        providerId: 'azure-openai-responses',
        encryptedCredentials: stored?.encryptedCredentials ?? {},
      }),
    ).toEqual(credentials);
    expect(stored?.keyFingerprints).toEqual({
      endpoint: 'https://azure.example.test/openai/v1',
      api_key: 'sk-azure...abcd',
    });
  });

  it('validates and stores Cloudflare provider configs with multi-field credentials', async () => {
    const probe = vi.fn();
    const credentials = {
      api_key: 'cf-secret-abcd',
      account_id: 'account-123',
      gateway_id: 'gateway-456',
    };

    const config = await testAndSaveProviderConfig(
      {
        workspaceId,
        providerId: 'cloudflare-ai-gateway',
        credentials,
      },
      {probe},
    );

    const stored = await getAgentProviderConfig({
      workspaceId,
      providerId: 'cloudflare-ai-gateway',
    });
    expect(stored).toEqual(config);
    expect(
      decryptCredentials({
        workspaceId,
        providerId: 'cloudflare-ai-gateway',
        encryptedCredentials: stored?.encryptedCredentials ?? {},
      }),
    ).toEqual(credentials);
    expect(stored?.keyFingerprints).toEqual({
      api_key: 'cf-secre...abcd',
      account_id: 'account-123',
      gateway_id: 'gateway-456',
    });
  });

  it('rejects mismatched credential fields and persists nothing', async () => {
    const probe = vi.fn();

    const save = testAndSaveProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {wrong_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow(InvalidCredentialFieldsError);
    expect(probe).not.toHaveBeenCalled();
    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('validates the local encryption key before probing the provider', async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_CREDENTIALS_ENCRYPTION_KEY', '');
    const module = await import('./provider-config-service.js');
    const probe = vi.fn();

    const save = module.testAndSaveProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow('AGENT_CREDENTIALS_ENCRYPTION_KEY is required');
    expect(probe).not.toHaveBeenCalled();
  });
});
