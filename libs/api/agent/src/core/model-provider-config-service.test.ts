import crypto from 'node:crypto';
import {getSecretsByNamespace, setSecrets} from '@shipfox/api-secrets';
import {getModelProviderConfig, upsertModelProviderConfig} from '#db/index.js';
import {agentSystemNamespace} from './credential-fingerprints.js';
import {
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
} from './errors.js';
import {
  deleteModelProviderConfig,
  testAndSaveModelProviderConfig,
  updateModelProviderConfigDefaultModel,
} from './model-provider-config-service.js';

describe('testAndSaveModelProviderConfig', () => {
  let workspaceId: string;

  beforeEach(() => {
    workspaceId = crypto.randomUUID();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('validates, stores secrets, fingerprints, and stores a provider config', async () => {
    const credentials = {api_key: 'sk-ant-secret-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials,
        editedBy: '11111111-1111-4111-8111-111111111111',
      },
      {probe},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
    });

    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(secrets).toEqual({API_KEY: credentials.api_key});
    expect(stored?.keyFingerprints).toEqual({'credential:api_key': '...abcd'});
    expect(stored?.defaultModel).toBeNull();
    expect(stored?.defaultThinking).toBe('high');
  });

  it('validates and stores an explicit provider default model', async () => {
    const credentials = {api_key: 'sk-ant-secret-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        defaultModel: 'claude-haiku-4-5',
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-haiku-4-5',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.defaultModel).toBe('claude-haiku-4-5');
  });

  it('passes the abort signal to the provider probe', async () => {
    const credentials = {api_key: 'sk-ant-secret-abcd'};
    const abortController = new AbortController();
    const probe = vi.fn().mockResolvedValue(undefined);

    await testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials, signal: abortController.signal},
      {probe},
    );

    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-opus-4-8',
      credentials,
      signal: abortController.signal,
    });
  });

  it('rethrows aborted probe errors without treating them as validation failures', async () => {
    const abortController = new AbortController();
    const error = new Error('Provider probe aborted');
    const probe = vi.fn().mockRejectedValue(error);
    abortController.abort();

    const save = testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials: {api_key: 'sk-ant-secret-abcd'},
        signal: abortController.signal,
      },
      {probe},
    );

    await expect(save).rejects.toBe(error);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('preserves an existing default model when rotating credentials without a model selection', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      keyFingerprints: {'credential:api_key': '...abcd'},
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });
    const credentials = {api_key: 'sk-ant-rotated-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(probe).toHaveBeenCalledWith({
      providerId: 'anthropic',
      model: 'claude-haiku-4-5',
      credentials,
    });
    expect(stored).toEqual(config);
    expect(stored?.defaultModel).toBe('claude-haiku-4-5');
  });

  it('stores Latest when rotating credentials with a null default model selection', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      keyFingerprints: {'credential:api_key': '...abcd'},
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });
    const credentials = {api_key: 'sk-ant-rotated-abcd'};
    const probe = vi.fn().mockResolvedValue(undefined);

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        defaultModel: null,
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
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

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: secret}},
      {probe},
    );

    await expect(save).rejects.toThrow(ModelProviderValidationError);
    await expect(save).rejects.not.toThrow(secret);
    await expect(save).rejects.not.toThrow(base64Secret);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('sanitizes non-Error probe failures and persists nothing', async () => {
    const probe = vi.fn().mockRejectedValue('raw thrown value');

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow('Provider validation failed.');
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('leaves an existing row unchanged when credential rotation validation fails', async () => {
    const existing = await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      keyFingerprints: {'credential:api_key': '...abcd'},
      defaultModel: 'claude-opus-4-8',
      defaultThinking: 'high',
    });
    const probe = vi.fn().mockRejectedValue(new Error('bad key'));

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-new-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow(ModelProviderValidationError);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toEqual(existing);
  });

  it('propagates InvalidAgentModelError and persists nothing', async () => {
    const error = new InvalidAgentModelError('anthropic', 'claude-opus-4-8');
    const probe = vi.fn().mockRejectedValue(error);

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {api_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toBe(error);
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('rejects an explicit default model outside the model provider catalog', async () => {
    const probe = vi.fn();

    const save = testAndSaveModelProviderConfig(
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
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('updates the default model without changing credentials', async () => {
    const existing = await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      keyFingerprints: {'credential:api_key': '...abcd'},
      defaultModel: null,
      defaultThinking: 'high',
    });

    const updated = await updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
    });

    expect(updated).toMatchObject({
      keyFingerprints: existing.keyFingerprints,
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: existing.defaultThinking,
    });
  });

  it('stores null when the default model is set to Latest', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      keyFingerprints: {'credential:api_key': '...abcd'},
      defaultModel: 'claude-haiku-4-5',
      defaultThinking: 'high',
    });

    const updated = await updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
    });

    expect(updated.defaultModel).toBeNull();
  });

  it('rejects a default model update for a missing config', async () => {
    const update = updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId: 'anthropic',
      defaultModel: null,
    });

    await expect(update).rejects.toThrow(ModelProviderConfigNotFoundError);
  });

  it('rejects a default model update outside the model provider catalog', async () => {
    await upsertModelProviderConfig({
      workspaceId,
      providerId: 'anthropic',
      keyFingerprints: {'credential:api_key': '...abcd'},
      defaultModel: null,
      defaultThinking: 'high',
    });

    const update = updateModelProviderConfigDefaultModel({
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

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'azure-openai-responses',
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({
      workspaceId,
      providerId: 'azure-openai-responses',
    });
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('azure-openai-responses'),
    });

    expect(stored).toEqual(config);
    expect(secrets).toEqual({
      ENDPOINT: credentials.endpoint,
      API_KEY: credentials.api_key,
    });
    expect(stored?.keyFingerprints).toEqual({
      'credential:endpoint': 'https://azure.example.test/openai/v1',
      'credential:api_key': '...abcd',
    });
  });

  it('validates and stores Cloudflare provider configs with multi-field credentials', async () => {
    const probe = vi.fn();
    const credentials = {
      api_key: 'cf-secret-abcd',
      account_id: 'account-123',
      gateway_id: 'gateway-456',
    };

    const config = await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'cloudflare-ai-gateway',
        credentials,
      },
      {probe},
    );

    const stored = await getModelProviderConfig({
      workspaceId,
      providerId: 'cloudflare-ai-gateway',
    });
    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('cloudflare-ai-gateway'),
    });

    expect(stored).toEqual(config);
    expect(secrets).toEqual({
      API_KEY: credentials.api_key,
      ACCOUNT_ID: credentials.account_id,
      GATEWAY_ID: credentials.gateway_id,
    });
    expect(stored?.keyFingerprints).toEqual({
      'credential:api_key': '...abcd',
      'credential:account_id': 'account-123',
      'credential:gateway_id': 'gateway-456',
    });
  });

  it('rejects mismatched credential fields and persists nothing', async () => {
    const probe = vi.fn();

    const save = testAndSaveModelProviderConfig(
      {workspaceId, providerId: 'anthropic', credentials: {wrong_key: 'sk-ant-secret-abcd'}},
      {probe},
    );

    await expect(save).rejects.toThrow(InvalidCredentialFieldsError);
    expect(probe).not.toHaveBeenCalled();
    const stored = await getModelProviderConfig({workspaceId, providerId: 'anthropic'});
    expect(stored).toBeUndefined();
  });

  it('replaces the provider namespace exactly on credential rotation', async () => {
    await setSecrets({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
      values: {API_KEY: 'sk-old-secret', STALE_KEY: 'stale-secret'},
    });
    const probe = vi.fn().mockResolvedValue(undefined);

    await testAndSaveModelProviderConfig(
      {
        workspaceId,
        providerId: 'anthropic',
        credentials: {api_key: 'sk-ant-rotated-abcd'},
      },
      {probe},
    );

    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
    });
    expect(secrets).toEqual({API_KEY: 'sk-ant-rotated-abcd'});
  });

  it('deletes provider secrets even when the config row is already absent', async () => {
    await setSecrets({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
      values: {API_KEY: 'orphaned-secret'},
    });

    const deleted = await deleteModelProviderConfig({workspaceId, providerId: 'anthropic'});

    const secrets = await getSecretsByNamespace({
      workspaceId,
      namespace: agentSystemNamespace('anthropic'),
    });
    expect(deleted).toBe(false);
    expect(secrets).toEqual({});
  });
});
