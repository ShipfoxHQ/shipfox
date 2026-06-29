import {
  agentProviderCredentialKeysMatch,
  DEFAULT_AGENT_THINKING,
  getAgentProviderEntry,
  type SupportedAgentProviderId,
} from '@shipfox/api-agent-dto';
import {
  getAgentProviderConfig,
  updateAgentProviderDefaultModel,
  upsertAgentProviderConfig,
} from '#db/index.js';
import {providerValidationCount} from '#metrics/index.js';
import {
  encryptCredentials,
  ensureCredentialsEncryptionKeyConfigured,
  fingerprintCredentials,
} from './credential-encryption.js';
import type {AgentProviderConfig} from './entities/agent-provider-config.js';
import {
  AgentProviderConfigNotFoundError,
  AgentProviderValidationError,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  UnsupportedAgentProviderError,
} from './errors.js';
import {buildAgentProviderCatalog} from './provider-catalog.js';
import {probeProviderCredentials, sanitizeProviderError} from './provider-validation.js';

export interface TestAndSaveProviderConfigParams {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  defaultModel?: string | null | undefined;
  credentials: Record<string, string>;
  setAsDefault?: boolean | undefined;
}

export interface TestAndSaveProviderConfigOptions {
  probe?: typeof probeProviderCredentials;
}

export interface UpdateProviderConfigDefaultModelParams {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  defaultModel: string | null;
}

export async function testAndSaveProviderConfig(
  params: TestAndSaveProviderConfigParams,
  options: TestAndSaveProviderConfigOptions = {},
): Promise<AgentProviderConfig> {
  const probe = options.probe ?? probeProviderCredentials;
  const entry = getAgentProviderEntry(params.providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedAgentProviderError(params.providerId);
  }
  if (entry.default_model === null) throw new UnsupportedAgentProviderError(params.providerId);

  if (!agentProviderCredentialKeysMatch(params.providerId, params.credentials)) {
    throw new InvalidCredentialFieldsError(params.providerId);
  }

  ensureCredentialsEncryptionKeyConfigured();

  const existingConfig = await getAgentProviderConfig({
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
    });
  } catch (error) {
    providerValidationCount.add(1, {provider: params.providerId, outcome: 'failed'});
    if (error instanceof InvalidAgentModelError) throw error;

    const sanitizedMessage = sanitizeProviderError(error, Object.values(params.credentials));
    // Provider SDK errors can contain request headers or bodies with the API key, so this
    // handled validation error deliberately carries only the sanitized message.
    throw new AgentProviderValidationError(params.providerId, sanitizedMessage);
  }

  providerValidationCount.add(1, {provider: params.providerId, outcome: 'succeeded'});
  return await upsertAgentProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    encryptedCredentials: encryptCredentials({
      workspaceId: params.workspaceId,
      providerId: params.providerId,
      credentials: params.credentials,
    }),
    keyFingerprints: fingerprintCredentials(params.providerId, params.credentials),
    defaultModel: modelSelection.storedModel,
    defaultThinking: DEFAULT_AGENT_THINKING,
    setAsDefault: params.setAsDefault,
  });
}

export async function updateProviderConfigDefaultModel(
  params: UpdateProviderConfigDefaultModelParams,
): Promise<AgentProviderConfig> {
  const entry = getAgentProviderEntry(params.providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedAgentProviderError(params.providerId);
  }
  if (entry.default_model === null) throw new UnsupportedAgentProviderError(params.providerId);

  const modelSelection = resolveDefaultModel(params.providerId, params.defaultModel);
  const config = await updateAgentProviderDefaultModel({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    defaultModel: modelSelection.storedModel,
  });
  if (!config) throw new AgentProviderConfigNotFoundError(params.workspaceId, params.providerId);
  return config;
}

function resolveDefaultModel(
  providerId: SupportedAgentProviderId,
  requestedModel: string | null | undefined,
): {probeModel: string; storedModel: string | null} {
  const catalogEntry = buildAgentProviderCatalog().find((entry) => entry.id === providerId);
  if (
    catalogEntry === undefined ||
    catalogEntry.support_status !== 'supported' ||
    catalogEntry.default_model === null
  ) {
    throw new UnsupportedAgentProviderError(providerId);
  }

  const model = requestedModel ?? catalogEntry.default_model;
  if (!catalogEntry.models.some((candidate) => candidate.id === model)) {
    throw new InvalidAgentModelError(providerId, model);
  }
  return {probeModel: model, storedModel: requestedModel ?? null};
}
