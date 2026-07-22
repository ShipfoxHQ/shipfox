import {
  DEFAULT_AGENT_THINKING,
  getModelProviderEntry,
  type ModelProviderRef,
  modelProviderCredentialKeysMatch,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {
  deleteModelProviderConfig as deleteModelProviderConfigRow,
  getModelProviderConfig,
  updateModelProviderDefaultModel,
  upsertModelProviderConfig,
} from '#db/index.js';
import {agentSystemNamespace, credentialsToStoreValues} from './credential-fingerprints.js';
import type {ModelProviderConfig} from './entities/model-provider-config.js';
import {
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ModelProviderConfigNotFoundError,
  UnsupportedModelProviderError,
} from './errors.js';
import {buildModelProviderCatalog} from './model-provider-catalog.js';
import {probeModelProviderCredentials, runProviderProbe} from './model-provider-validation.js';
import {type AgentSecretsClient, requireAgentSecretsClient} from './secrets-client.js';

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
  secrets?: AgentSecretsClient | undefined;
  pruneStaleSecrets?:
    | ((params: {workspaceId: string; namespace: string; expectedKeys: string[]}) => Promise<void>)
    | undefined;
}

export interface UpdateModelProviderConfigDefaultModelParams {
  workspaceId: string;
  providerId: ModelProviderRef;
  defaultModel: string | null;
}

export async function testAndSaveModelProviderConfig(
  params: TestAndSaveModelProviderConfigParams,
  options: TestAndSaveModelProviderConfigOptions = {},
): Promise<ModelProviderConfig> {
  const probe = options.probe ?? probeModelProviderCredentials;
  const secrets = requireAgentSecretsClient(options.secrets);
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

  await runProviderProbe({
    probe,
    args: {
      providerId: params.providerId,
      model: modelSelection.probeModel,
      credentials: params.credentials,
      ...(params.signal ? {signal: params.signal} : {}),
    },
    metricLabel: params.providerId,
    providerId: params.providerId,
    secrets: Object.values(params.credentials),
    signal: params.signal,
  });
  const pruneStaleSecrets =
    options.pruneStaleSecrets ?? ((input) => pruneStaleProviderCredentialSecrets(secrets, input));
  const namespace = agentSystemNamespace(params.providerId);
  const values = credentialsToStoreValues(params.providerId, params.credentials);
  await secrets.setSecrets({
    workspaceId: params.workspaceId,
    namespace,
    values,
    editedBy: params.editedBy,
  });

  const config = await upsertModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    defaultModel: modelSelection.storedModel,
    defaultThinking: DEFAULT_AGENT_THINKING,
    setAsDefault: params.setAsDefault,
  });

  await pruneStaleSecrets({
    workspaceId: params.workspaceId,
    namespace,
    expectedKeys: Object.keys(values),
  }).catch((error) => {
    logger().error(
      {err: error, workspaceId: params.workspaceId, providerId: params.providerId},
      'Failed to prune stale model provider secrets',
    );
    reportError(error, {
      boundary: 'agent.cleanup',
      operation: 'prune-stale-secrets',
      extra: {workspaceId: params.workspaceId, providerId: params.providerId},
    });
  });

  return config;
}

export async function updateModelProviderConfigDefaultModel(
  params: UpdateModelProviderConfigDefaultModelParams,
): Promise<ModelProviderConfig> {
  const existingConfig = await getModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
  });
  if (!existingConfig) {
    throw new ModelProviderConfigNotFoundError(params.workspaceId, params.providerId);
  }
  if (existingConfig.kind === 'custom') {
    if (
      params.defaultModel !== null &&
      !existingConfig.models?.some((model) => model.id === params.defaultModel)
    ) {
      throw new InvalidAgentModelError('pi', params.providerId, params.defaultModel);
    }

    const config = await updateModelProviderDefaultModel({
      workspaceId: params.workspaceId,
      providerId: params.providerId,
      defaultModel: params.defaultModel,
    });
    if (!config) throw new ModelProviderConfigNotFoundError(params.workspaceId, params.providerId);
    return config;
  }

  const providerId = params.providerId as SupportedModelProviderId;
  const entry = getModelProviderEntry(providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(params.providerId);
  }
  if (entry.default_model === null) throw new UnsupportedModelProviderError(params.providerId);

  const modelSelection = resolveDefaultModel(providerId, params.defaultModel);
  const config = await updateModelProviderDefaultModel({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    defaultModel: modelSelection.storedModel,
  });
  if (!config) throw new ModelProviderConfigNotFoundError(params.workspaceId, params.providerId);
  return config;
}

export async function deleteModelProviderConfig(
  params: {workspaceId: string; providerId: ModelProviderRef},
  options: {secrets?: AgentSecretsClient | undefined} = {},
): Promise<boolean> {
  const secrets = requireAgentSecretsClient(options.secrets);
  const deleted = await deleteModelProviderConfigRow(params);
  await secrets.deleteSecrets({
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
    throw new InvalidAgentModelError('pi', providerId, model);
  }
  return {probeModel: model, storedModel: requestedModel ?? null};
}

async function pruneStaleProviderCredentialSecrets(
  secrets: AgentSecretsClient,
  params: {workspaceId: string; namespace: string; expectedKeys: string[]},
): Promise<void> {
  const {values: stored} = await secrets.getSecretsByNamespace({
    workspaceId: params.workspaceId,
    namespace: params.namespace,
  });
  const expected = new Set(params.expectedKeys);
  const staleKeys = Object.keys(stored).filter((key) => !expected.has(key));
  if (staleKeys.length === 0) return;

  await secrets.deleteSecrets({
    workspaceId: params.workspaceId,
    namespace: params.namespace,
    keys: staleKeys,
  });
}
