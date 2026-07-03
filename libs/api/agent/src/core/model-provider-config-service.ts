import {
  DEFAULT_AGENT_THINKING,
  getModelProviderEntry,
  type ModelProviderRef,
  modelProviderCredentialKeysMatch,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {deleteSecrets, setSecrets} from '@shipfox/api-secrets';
import {
  deleteModelProviderConfig as deleteModelProviderConfigRow,
  getModelProviderConfig,
  updateModelProviderDefaultModel,
  upsertModelProviderConfig,
} from '#db/index.js';
import {modelProviderValidationCount} from '#metrics/index.js';
import {
  agentSystemNamespace,
  credentialsToStoreValues,
  fingerprintCredentials,
} from './credential-fingerprints.js';
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
  providerId: SupportedModelProviderId;
  defaultModel?: string | null | undefined;
  credentials: Record<string, string>;
  editedBy?: string | null | undefined;
  setAsDefault?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface TestAndSaveModelProviderConfigOptions {
  probe?: typeof probeModelProviderCredentials;
}

export interface UpdateModelProviderConfigDefaultModelParams {
  workspaceId: string;
  providerId: SupportedModelProviderId;
  defaultModel: string | null;
}

export async function testAndSaveModelProviderConfig(
  params: TestAndSaveModelProviderConfigParams,
  options: TestAndSaveModelProviderConfigOptions = {},
): Promise<ModelProviderConfig> {
  const probe = options.probe ?? probeModelProviderCredentials;
  const entry = getModelProviderEntry(params.providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(params.providerId);
  }
  if (entry.default_model === null) throw new UnsupportedModelProviderError(params.providerId);

  if (!modelProviderCredentialKeysMatch(params.providerId, params.credentials)) {
    throw new InvalidCredentialFieldsError(params.providerId);
  }

  const existingConfig = await getModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
  });
  const modelSelection = resolveDefaultModel(
    params.providerId,
    params.defaultModel !== undefined ? params.defaultModel : existingConfig?.defaultModel,
  );

  try {
    await probe({
      providerId: params.providerId,
      model: modelSelection.probeModel,
      credentials: params.credentials,
      ...(params.signal ? {signal: params.signal} : {}),
    });
  } catch (error) {
    if (params.signal?.aborted) throw error;
    modelProviderValidationCount.add(1, {
      model_provider: params.providerId,
      outcome: 'failed',
    });
    if (error instanceof InvalidAgentModelError) throw error;

    const sanitizedMessage = sanitizeModelProviderError(error, Object.values(params.credentials));
    // Model provider SDK errors can contain request headers or bodies with the API key, so this
    // handled validation error deliberately carries only the sanitized message.
    throw new ModelProviderValidationError(params.providerId, sanitizedMessage);
  }

  modelProviderValidationCount.add(1, {
    model_provider: params.providerId,
    outcome: 'succeeded',
  });
  const namespace = agentSystemNamespace(params.providerId);
  await deleteSecrets({workspaceId: params.workspaceId, namespace});
  await setSecrets({
    workspaceId: params.workspaceId,
    namespace,
    values: credentialsToStoreValues(params.providerId, params.credentials),
    editedBy: params.editedBy,
  });

  return await upsertModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    keyFingerprints: fingerprintCredentials(params.providerId, params.credentials),
    defaultModel: modelSelection.storedModel,
    defaultThinking: DEFAULT_AGENT_THINKING,
    setAsDefault: params.setAsDefault,
  });
}

export async function updateModelProviderConfigDefaultModel(
  params: UpdateModelProviderConfigDefaultModelParams,
): Promise<ModelProviderConfig> {
  const entry = getModelProviderEntry(params.providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(params.providerId);
  }
  if (entry.default_model === null) throw new UnsupportedModelProviderError(params.providerId);

  const modelSelection = resolveDefaultModel(params.providerId, params.defaultModel);
  const config = await updateModelProviderDefaultModel({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    defaultModel: modelSelection.storedModel,
  });
  if (!config) throw new ModelProviderConfigNotFoundError(params.workspaceId, params.providerId);
  return config;
}

export async function deleteModelProviderConfig(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
}): Promise<boolean> {
  const deleted = await deleteModelProviderConfigRow(params);
  await deleteSecrets({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.providerId),
  });
  return deleted;
}

function resolveDefaultModel(
  providerId: SupportedModelProviderId,
  requestedModel: string | null | undefined,
): {probeModel: string; storedModel: string | null} {
  const catalogEntry = buildModelProviderCatalog().find((entry) => entry.id === providerId);
  if (
    catalogEntry === undefined ||
    catalogEntry.support_status !== 'supported' ||
    catalogEntry.default_model === null
  ) {
    throw new UnsupportedModelProviderError(providerId);
  }

  const model = requestedModel ?? catalogEntry.default_model;
  if (!catalogEntry.models.some((candidate) => candidate.id === model)) {
    throw new InvalidAgentModelError(providerId, model);
  }
  return {probeModel: model, storedModel: requestedModel ?? null};
}
