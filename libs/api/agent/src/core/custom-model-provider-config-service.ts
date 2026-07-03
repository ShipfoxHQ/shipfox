import {
  type CreateCustomModelProviderBodyDto,
  type CustomAgentModelDto,
  type CustomModelProviderHeaderDto,
  type CustomModelProviderHeaderRequestDto,
  DEFAULT_AGENT_THINKING,
  type ModelProviderRef,
  type UpdateCustomModelProviderBodyDto,
} from '@shipfox/api-agent-dto';
import {deleteSecrets, getSecretsByNamespace, setSecrets} from '@shipfox/api-secrets';
import {
  getModelProviderConfig,
  insertCustomModelProviderConfig,
  upsertModelProviderConfig,
} from '#db/index.js';
import {
  agentSystemNamespace,
  customCredentialToStoreKey,
  customCredentialsToStoreValues,
  fingerprintCustomCredentials,
  storeValuesToCustomRuntimeCredentials,
} from './credential-fingerprints.js';
import {assertEgressAllowed} from './egress-guard.js';
import type {ModelProviderConfig} from './entities/model-provider-config.js';
import {
  CustomModelProviderConfigNotFoundError,
  CustomModelProviderSlugCollisionError,
} from './errors.js';
import {
  egressPolicy,
  probeCustomModelProviderCredentials,
  runProviderProbe,
} from './model-provider-validation.js';

export interface CreateCustomModelProviderConfigParams {
  workspaceId: string;
  body: CreateCustomModelProviderBodyDto;
  setAsDefault?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface UpdateCustomModelProviderConfigParams {
  workspaceId: string;
  providerId: ModelProviderRef;
  body: UpdateCustomModelProviderBodyDto;
  signal?: AbortSignal | undefined;
}

export interface CustomModelProviderConfigServiceOptions {
  probe?: typeof probeCustomModelProviderCredentials | undefined;
}

interface SplitHeaders {
  plaintextHeaders: CustomModelProviderHeaderDto[];
  secretCredentials: Record<string, string>;
  runtimeHeaders: Record<string, string>;
}

export async function createCustomModelProviderConfig(
  params: CreateCustomModelProviderConfigParams,
  options: CustomModelProviderConfigServiceOptions = {},
): Promise<ModelProviderConfig> {
  const probe = options.probe ?? probeCustomModelProviderCredentials;

  const splitHeaders = splitCustomHeaders(params.body.headers ?? []);
  const secretCredentials = {
    ...(params.body.api_key ? {api_key: params.body.api_key} : {}),
    ...splitHeaders.secretCredentials,
  };
  const probeModel = selectProbeModel(params.body.models, params.body.default_model ?? null);

  await assertEgressAllowed(params.body.base_url, egressPolicy());
  await runProviderProbe({
    probe,
    args: {
      providerId: params.body.slug,
      api: params.body.api,
      baseUrl: params.body.base_url,
      model: probeModel,
      apiKey: params.body.api_key,
      headers: splitHeaders.runtimeHeaders,
      ...(params.signal ? {signal: params.signal} : {}),
    },
    metricLabel: 'custom',
    providerId: params.body.slug,
    secrets: Object.values(secretCredentials),
    signal: params.signal,
  });

  const config = await insertCustomModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.body.slug,
    kind: 'custom',
    displayName: params.body.display_name,
    api: params.body.api,
    baseUrl: params.body.base_url,
    headers: splitHeaders.plaintextHeaders,
    models: params.body.models,
    keyFingerprints: fingerprintCustomCredentials(secretCredentials),
    defaultModel: params.body.default_model ?? null,
    defaultThinking: DEFAULT_AGENT_THINKING,
    setAsDefault: params.setAsDefault,
  });
  if (!config) {
    throw new CustomModelProviderSlugCollisionError(params.workspaceId, params.body.slug);
  }

  await setSecrets({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.body.slug),
    values: customCredentialsToStoreValues(secretCredentials),
  });

  return config;
}

export async function updateCustomModelProviderConfig(
  params: UpdateCustomModelProviderConfigParams,
  options: CustomModelProviderConfigServiceOptions = {},
): Promise<ModelProviderConfig> {
  const probe = options.probe ?? probeCustomModelProviderCredentials;

  const existing = await getExistingCustomConfig(params.workspaceId, params.providerId);
  const existingSecrets = await getCustomProviderSecrets({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
  });
  const nextModels = params.body.models ?? existing.models ?? [];
  const nextDefaultModel = resolveNextDefaultModel(existing.defaultModel, nextModels, params.body);
  const nextApi = params.body.api ?? existing.api ?? 'openai-responses';
  const nextBaseUrl = params.body.base_url ?? existing.baseUrl ?? '';
  const nextDisplayName = params.body.display_name ?? existing.displayName ?? params.providerId;
  const nextHeaders = resolveNextHeaders(params.body.headers, existing, existingSecrets);
  const nextApiKey = params.body.api_key ?? existingSecrets.api_key;
  const newSecretCredentials = {
    ...(params.body.api_key ? {api_key: params.body.api_key} : {}),
    ...nextHeaders.newSecretCredentials,
  };
  const probeSecretCredentials = {
    ...(nextApiKey ? {api_key: nextApiKey} : {}),
    ...nextHeaders.probeSecretCredentials,
  };

  await assertEgressAllowed(nextBaseUrl, egressPolicy());
  await runProviderProbe({
    probe,
    args: {
      providerId: params.providerId,
      api: nextApi,
      baseUrl: nextBaseUrl,
      model: selectProbeModel(nextModels, nextDefaultModel),
      apiKey: nextApiKey,
      headers: nextHeaders.runtimeHeaders,
      ...(params.signal ? {signal: params.signal} : {}),
    },
    metricLabel: 'custom',
    providerId: params.providerId,
    secrets: Object.values(probeSecretCredentials),
    signal: params.signal,
  });

  const keyFingerprints = mergeKeyFingerprints({
    existing: existing.keyFingerprints,
    newSecrets: newSecretCredentials,
    replaceHeaders: params.body.headers !== undefined,
  });

  const updated = await upsertModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    kind: 'custom',
    displayName: nextDisplayName,
    api: nextApi,
    baseUrl: nextBaseUrl,
    headers: nextHeaders.plaintextHeaders,
    models: nextModels,
    keyFingerprints,
    defaultModel: nextDefaultModel,
    defaultThinking: existing.defaultThinking,
  });

  await setSecrets({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.providerId),
    values: customCredentialsToStoreValues(newSecretCredentials),
  });
  await pruneStaleCustomHeaderSecrets({
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    existingSecrets,
    newSecrets: newSecretCredentials,
    replaceHeaders: params.body.headers !== undefined,
  });

  return updated;
}

async function getExistingCustomConfig(
  workspaceId: string,
  providerId: ModelProviderRef,
): Promise<ModelProviderConfig> {
  const existing = await getModelProviderConfig({workspaceId, providerId});
  if (existing?.kind !== 'custom') {
    throw new CustomModelProviderConfigNotFoundError(workspaceId, providerId);
  }
  return existing;
}

function splitCustomHeaders(headers: CustomModelProviderHeaderRequestDto[]): SplitHeaders {
  const plaintextHeaders: CustomModelProviderHeaderDto[] = [];
  const secretCredentials: Record<string, string> = {};
  const runtimeHeaders: Record<string, string> = {};

  for (const header of headers) {
    runtimeHeaders[header.name] = header.value;
    if (header.secret) {
      secretCredentials[`header:${header.name}`] = header.value;
    } else {
      plaintextHeaders.push({name: header.name, value: header.value});
    }
  }

  return {plaintextHeaders, secretCredentials, runtimeHeaders};
}

function resolveNextHeaders(
  requestHeaders: CustomModelProviderHeaderRequestDto[] | undefined,
  existing: ModelProviderConfig,
  existingSecrets: Record<string, string>,
): {
  plaintextHeaders: CustomModelProviderHeaderDto[];
  runtimeHeaders: Record<string, string>;
  probeSecretCredentials: Record<string, string>;
  newSecretCredentials: Record<string, string>;
} {
  if (requestHeaders !== undefined) {
    const splitHeaders = splitCustomHeaders(requestHeaders);
    return {
      plaintextHeaders: splitHeaders.plaintextHeaders,
      runtimeHeaders: splitHeaders.runtimeHeaders,
      probeSecretCredentials: splitHeaders.secretCredentials,
      newSecretCredentials: splitHeaders.secretCredentials,
    };
  }

  const runtimeHeaders: Record<string, string> = {};
  for (const header of existing.headers ?? []) {
    runtimeHeaders[header.name] = header.value;
  }

  const probeSecretCredentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(existingSecrets)) {
    if (!key.startsWith('header:')) continue;
    const name = key.slice('header:'.length);
    runtimeHeaders[name] = value;
    probeSecretCredentials[key] = value;
  }

  return {
    plaintextHeaders: existing.headers ?? [],
    runtimeHeaders,
    probeSecretCredentials,
    newSecretCredentials: {},
  };
}

function resolveNextDefaultModel(
  existingDefaultModel: string | null,
  models: CustomAgentModelDto[],
  body: UpdateCustomModelProviderBodyDto,
): string | null {
  const requestedDefaultModel =
    'default_model' in body ? (body.default_model ?? null) : existingDefaultModel;
  if (requestedDefaultModel === null) return null;
  return models.some((model) => model.id === requestedDefaultModel) ? requestedDefaultModel : null;
}

function selectProbeModel(
  models: CustomAgentModelDto[],
  defaultModel: string | null,
): CustomAgentModelDto {
  const model = models.find((candidate) => candidate.id === defaultModel) ?? models[0];
  if (!model) throw new Error('Custom model provider must include at least one model.');
  return model;
}

async function getCustomProviderSecrets(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
}): Promise<Record<string, string>> {
  const values = await getSecretsByNamespace({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.providerId),
  });
  return storeValuesToCustomRuntimeCredentials(values);
}

async function pruneStaleCustomHeaderSecrets(params: {
  workspaceId: string;
  providerId: ModelProviderRef;
  existingSecrets: Record<string, string>;
  newSecrets: Record<string, string>;
  replaceHeaders: boolean;
}): Promise<void> {
  if (!params.replaceHeaders) return;

  const nextKeys = new Set(Object.keys(params.newSecrets));
  const staleKeys = Object.keys(params.existingSecrets).filter(
    (key) => key.startsWith('header:') && !nextKeys.has(key),
  );
  if (staleKeys.length === 0) return;

  await deleteSecrets({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.providerId),
    keys: staleKeys.map(customCredentialToStoreKey),
  });
}

function mergeKeyFingerprints(params: {
  existing: Record<string, string>;
  newSecrets: Record<string, string>;
  replaceHeaders: boolean;
}): Record<string, string> {
  const existing = params.replaceHeaders
    ? withoutHeaderCredentials(params.existing)
    : params.existing;
  return {
    ...existing,
    ...fingerprintCustomCredentials(params.newSecrets),
  };
}

function withoutHeaderCredentials(credentials: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(credentials).filter(([key]) => !key.startsWith('header:')),
  );
}
