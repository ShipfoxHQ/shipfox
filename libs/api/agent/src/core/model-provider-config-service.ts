import {
  DEFAULT_AGENT_THINKING,
  getModelProviderEntry,
  modelProviderCredentialKeysMatch,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {
  getModelProviderConfig,
  updateModelProviderDefaultModel,
  upsertModelProviderConfig,
} from '#db/index.js';
import {modelProviderValidationCount} from '#metrics/index.js';
import {
  encryptCredentials,
  ensureCredentialsEncryptionKeyConfigured,
  fingerprintCredentials,
} from './credential-encryption.js';
import type {ModelProviderConfig} from './entities/model-provider-config.js';
import {
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
  UnsupportedModelProviderError,
} from './errors.js';
import {buildModelProviderCatalog} from './model-provider-catalog.js';
import {
  probeModelProviderCredentials,
  sanitizeModelProviderError,
} from './model-provider-validation.js';

export interface TestAndSaveModelProviderConfigParams {
  workspaceId: string;
  modelProviderId: SupportedModelProviderId;
  defaultModel?: string | null | undefined;
  credentials: Record<string, string>;
  setAsDefault?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface TestAndSaveModelProviderConfigOptions {
  probe?: typeof probeModelProviderCredentials;
}

export interface UpdateModelProviderConfigDefaultModelParams {
  workspaceId: string;
  modelProviderId: SupportedModelProviderId;
  defaultModel: string | null;
}

export async function testAndSaveModelProviderConfig(
  params: TestAndSaveModelProviderConfigParams,
  options: TestAndSaveModelProviderConfigOptions = {},
): Promise<ModelProviderConfig> {
  const probe = options.probe ?? probeModelProviderCredentials;
  const entry = getModelProviderEntry(params.modelProviderId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(params.modelProviderId);
  }
  if (entry.default_model === null) throw new UnsupportedModelProviderError(params.modelProviderId);

  if (!modelProviderCredentialKeysMatch(params.modelProviderId, params.credentials)) {
    throw new InvalidCredentialFieldsError(params.modelProviderId);
  }

  ensureCredentialsEncryptionKeyConfigured();

  const existingConfig = await getModelProviderConfig({
    workspaceId: params.workspaceId,
    modelProviderId: params.modelProviderId,
  });
  const modelSelection = resolveDefaultModel(
    params.modelProviderId,
    params.defaultModel !== undefined ? params.defaultModel : existingConfig?.defaultModel,
  );

  try {
    await probe({
      modelProviderId: params.modelProviderId,
      model: modelSelection.probeModel,
      credentials: params.credentials,
      ...(params.signal ? {signal: params.signal} : {}),
    });
  } catch (error) {
    if (params.signal?.aborted) throw error;
    modelProviderValidationCount.add(1, {
      model_provider: params.modelProviderId,
      outcome: 'failed',
    });
    if (error instanceof InvalidAgentModelError) throw error;

    const sanitizedMessage = sanitizeModelProviderError(error, Object.values(params.credentials));
    // Model provider SDK errors can contain request headers or bodies with the API key, so this
    // handled validation error deliberately carries only the sanitized message.
    throw new ModelProviderValidationError(params.modelProviderId, sanitizedMessage);
  }

  modelProviderValidationCount.add(1, {
    model_provider: params.modelProviderId,
    outcome: 'succeeded',
  });
  return await upsertModelProviderConfig({
    workspaceId: params.workspaceId,
    modelProviderId: params.modelProviderId,
    encryptedCredentials: encryptCredentials({
      workspaceId: params.workspaceId,
      modelProviderId: params.modelProviderId,
      credentials: params.credentials,
    }),
    keyFingerprints: fingerprintCredentials(params.modelProviderId, params.credentials),
    defaultModel: modelSelection.storedModel,
    defaultThinking: DEFAULT_AGENT_THINKING,
    setAsDefault: params.setAsDefault,
  });
}

export async function updateModelProviderConfigDefaultModel(
  params: UpdateModelProviderConfigDefaultModelParams,
): Promise<ModelProviderConfig> {
  const entry = getModelProviderEntry(params.modelProviderId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(params.modelProviderId);
  }
  if (entry.default_model === null) throw new UnsupportedModelProviderError(params.modelProviderId);

  const modelSelection = resolveDefaultModel(params.modelProviderId, params.defaultModel);
  const config = await updateModelProviderDefaultModel({
    workspaceId: params.workspaceId,
    modelProviderId: params.modelProviderId,
    defaultModel: modelSelection.storedModel,
  });
  if (!config)
    throw new ModelProviderConfigNotFoundError(params.workspaceId, params.modelProviderId);
  return config;
}

function resolveDefaultModel(
  modelProviderId: SupportedModelProviderId,
  requestedModel: string | null | undefined,
): {probeModel: string; storedModel: string | null} {
  const catalogEntry = buildModelProviderCatalog().find((entry) => entry.id === modelProviderId);
  if (
    catalogEntry === undefined ||
    catalogEntry.support_status !== 'supported' ||
    catalogEntry.default_model === null
  ) {
    throw new UnsupportedModelProviderError(modelProviderId);
  }

  const model = requestedModel ?? catalogEntry.default_model;
  if (!catalogEntry.models.some((candidate) => candidate.id === model)) {
    throw new InvalidAgentModelError(modelProviderId, model);
  }
  return {probeModel: model, storedModel: requestedModel ?? null};
}
