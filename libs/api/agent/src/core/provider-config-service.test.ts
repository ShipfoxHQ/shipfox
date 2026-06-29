import crypto from 'node:crypto';
import {getAgentProviderConfig, upsertAgentProviderConfig} from '#db/index.js';
import {decryptCredentials} from './credential-encryption.js';
import {
  AgentProviderConfigNotFoundError,
  AgentProviderValidationError,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
} from './errors.js';
import {
  testAndSaveProviderConfig,
  updateProviderConfigDefaultModel,
} from './provider-config-service.js';

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
    expect(stored?.defaultModel).toBeNull();
    expect(stored?.defaultThinking).toBe('high');
  });

  it('validates and stores an explicit provider default model', async () => {
    const credentials = {api_key: 'sk-ant-secret-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        defaultModel: 'claude-haiku-4-5',
        credentials,
      },
      {probe},
    );

    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-haiku-4-5',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.defaultModel).toBe('claude-haiku-4-5');
  });

  it('preserves an existing default model when rotating credentials without a model selection', async () => {
    await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      encryptedCredentials: {api_key: 'already-encrypted'},
      keyFingerprints: {api_key: 'sk-old...abcd'},
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });
    const credentials = {api_key: 'sk-ant-rotated-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials,
      },
      {probe},
    );

    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-haiku-4-5',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.defaultModel).toBe('claude-haiku-4-5');
  });

  it('stores Latest when rotating credentials with a null default model selection', async () => {
    await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      encryptedCredentials: {api_key: 'already-encrypted'},
      keyFingerprints: {api_key: 'sk-old...abcd'},
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });
    const credentials = {api_key: 'sk-ant-rotated-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        defaultModel: null,
        credentials,
      },
      {probe},
    );

    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.defaultModel).toBeNull();
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

  it('rejects an explicit default model outside the provider catalog', async () => {
    const probe = vi.fn();

    const save = testAndSaveProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        defaultModel: 'missing-model',
        credentials: {api_key: 'sk-ant-secret-abcd'},
      },
      {probe},
    );

    await expect(save).rejects.toThrow(InvalidAgentModelError);
    expect(probe).not.toHaveBeenCalled();
    const stored = await getAgentProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('updates the default model without changing credentials', async () => {
    const existing = await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      encryptedCredentials: {api_key: 'already-encrypted'},
      keyFingerprints: {api_key: 'sk-old...abcd'},
      defaultModel: null,
      defaultThinking: 'high',
    });

    const updated = await updateProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });

    expect(updated).toMatchObject({
      encryptedCredentials: existing.encryptedCredentials,
      keyFingerprints: existing.keyFingerprints,
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: existing.defaultThinking,
    });
  });

  it('stores null when the default model is set to Latest', async () => {
    await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      encryptedCredentials: {api_key: 'already-encrypted'},
      keyFingerprints: {api_key: 'sk-old...abcd'},
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });

    const updated = await updateProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
    });

    expect(updated.defaultModel).toBeNull();
  });

  it('rejects a default model update for a missing config', async () => {
    const update = updateProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
    });

    await expect(update).rejects.toThrow(AgentProviderConfigNotFoundError);
  });

  it('rejects a default model update outside the provider catalog', async () => {
    await upsertAgentProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      encryptedCredentials: {api_key: 'already-encrypted'},
      keyFingerprints: {api_key: 'sk-old...abcd'},
      defaultModel: null,
      defaultThinking: 'high',
    });

    const update = updateProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'missing-model',
    });

    await expect(update).rejects.toThrow(InvalidAgentModelError);
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
