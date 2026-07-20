import {
  type CreateCustomModelProviderBodyDto,
  type CustomAgentModelDto,
  type CustomModelProviderHeaderDto,
  type CustomModelProviderHeaderRequestDto,
  DEFAULT_AGENT_THINKING,
  type DiscoverCustomModelProviderModelsBodyDto,
  type DiscoverCustomModelProviderModelsBySlugBodyDto,
  type ModelProviderRef,
  type UpdateCustomModelProviderBodyDto,
  type UpdateCustomModelProviderHeaderRequestDto,
} from '@shipfox/api-agent-dto';
import {assertEgressAllowed} from '@shipfox/node-egress-guard';
import {
  deleteModelProviderConfig,
  getModelProviderConfig,
  insertCustomModelProviderConfig,
  upsertModelProviderConfig,
} from '#db/index.js';
import {
  agentSystemNamespace,
  customCredentialsToStoreValues,
  customCredentialToStoreKey,
  storeValuesToCustomRuntimeCredentials,
} from './credential-fingerprints.js';
import {normalizeCustomProviderBaseUrl} from './custom-provider-url.js';
import type {ModelProviderConfig} from './entities/model-provider-config.js';
import {
  CustomModelProviderConfigNotFoundError,
  CustomModelProviderSlugCollisionError,
  CustomModelProviderStoredSecretBaseUrlChangeError,
  InvalidAgentModelError,
  InvalidCustomModelProviderHeaderKeepError,
} from './errors.js';
import {
  egressPolicy,
  probeCustomModelProviderCredentials,
  runProviderProbe,
} from './model-provider-validation.js';
import {type AgentSecretsClient, requireAgentSecretsClient} from './secrets-client.js';

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
  secrets?: AgentSecretsClient | undefined;
}

interface SplitHeaders {
  plaintextHeaders: CustomModelProviderHeaderDto[];
  secretHeaderNames: string[];
  secretCredentials: Record<string, string>;
  runtimeHeaders: Record<string, string>;
}

export async function createCustomModelProviderConfig(
  params: CreateCustomModelProviderConfigParams,
  options: CustomModelProviderConfigServiceOptions = {},
): Promise<ModelProviderConfig> {
  const probe = options.probe ?? probeCustomModelProviderCredentials;
  const secrets = requireAgentSecretsClient(options.secrets);

  const existing = await getModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.body.slug,
  });
  if (existing !== undefined) {
    throw new CustomModelProviderSlugCollisionError(params.workspaceId, params.body.slug);
  }

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
    secretHeaderNames: splitHeaders.secretHeaderNames,
    models: params.body.models,
    requiresApiKey: params.body.api_key !== undefined,
    defaultModel: params.body.default_model ?? null,
    defaultThinking: DEFAULT_AGENT_THINKING,
    setAsDefault: params.setAsDefault,
  });
  if (!config) {
    throw new CustomModelProviderSlugCollisionError(params.workspaceId, params.body.slug);
  }

  try {
    await secrets.setSecrets({
      workspaceId: params.workspaceId,
      namespace: agentSystemNamespace(params.body.slug),
      values: customCredentialsToStoreValues(secretCredentials),
    });
    return config;
  } catch (error) {
    await deleteModelProviderConfig({
      workspaceId: params.workspaceId,
      providerId: params.body.slug,
    });
    await secrets.deleteSecrets({
      workspaceId: params.workspaceId,
      namespace: agentSystemNamespace(params.body.slug),
    });
    throw error;
  }
}

export async function updateCustomModelProviderConfig(
  params: UpdateCustomModelProviderConfigParams,
  options: CustomModelProviderConfigServiceOptions = {},
): Promise<ModelProviderConfig> {
  const probe = options.probe ?? probeCustomModelProviderCredentials;
  const secrets = requireAgentSecretsClient(options.secrets);

  const existing = await getExistingCustomConfig(params.workspaceId, params.providerId);
  const existingSecrets = await getCustomProviderSecrets(secrets, {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
  });
  const nextModels = params.body.models ?? existing.models ?? [];
  const nextDefaultModel = resolveNextDefaultModel(
    params.providerId,
    existing.defaultModel,
    nextModels,
    params.body,
  );
  const nextApi = params.body.api ?? existing.api ?? 'openai-responses';
  const nextBaseUrl = params.body.base_url ?? existing.baseUrl ?? '';
  const nextDisplayName = params.body.display_name ?? existing.displayName ?? params.providerId;
  assertStoredSecretsNotReusedAfterBaseUrlChange({
    body: params.body,
    existing,
    existingSecrets,
    providerId: params.providerId,
  });
  const nextHeaders = resolveNextHeaders({
    requestHeaders: params.body.headers,
    existing,
    existingSecrets,
    providerId: params.providerId,
  });
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

  const namespace = agentSystemNamespace(params.providerId);
  await secrets.setSecrets({
    workspaceId: params.workspaceId,
    namespace,
    values: customCredentialsToStoreValues(newSecretCredentials),
  });

  let updated: ModelProviderConfig;
  try {
    updated = await upsertModelProviderConfig({
      workspaceId: params.workspaceId,
      providerId: params.providerId,
      kind: 'custom',
      displayName: nextDisplayName,
      api: nextApi,
      baseUrl: nextBaseUrl,
      headers: nextHeaders.plaintextHeaders,
      secretHeaderNames: nextHeaders.secretHeaderNames,
      models: nextModels,
      requiresApiKey: existing.requiresApiKey || params.body.api_key !== undefined,
      defaultModel: nextDefaultModel,
      defaultThinking: existing.defaultThinking,
    });
  } catch (error) {
    await rollbackCustomProviderSecretUpdate(secrets, {
      workspaceId: params.workspaceId,
      namespace,
      existingSecrets,
      attemptedSecrets: newSecretCredentials,
    }).catch(() => undefined);
    throw error;
  }

  await pruneStaleCustomHeaderSecrets(secrets, {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    existingSecrets,
    newSecrets: newSecretCredentials,
    replaceHeaders: params.body.headers !== undefined,
  });

  return updated;
}

export async function resolveCustomModelProviderDiscoveryParams(
  params: {
    workspaceId: string;
    providerId: ModelProviderRef;
    body: DiscoverCustomModelProviderModelsBySlugBodyDto;
  },
  options: {secrets?: AgentSecretsClient | undefined} = {},
): Promise<DiscoverCustomModelProviderModelsBodyDto> {
  const secrets = requireAgentSecretsClient(options.secrets);
  const existing = await getExistingCustomConfig(params.workspaceId, params.providerId);
  const existingSecrets = await getCustomProviderSecrets(secrets, {
    workspaceId: params.workspaceId,
    providerId: params.providerId,
  });
  assertStoredSecretsNotReusedAfterBaseUrlChange({
    body: params.body,
    existing,
    existingSecrets,
    providerId: params.providerId,
  });
  const headers = resolveNextHeaders({
    requestHeaders: params.body.headers,
    existing,
    existingSecrets,
    providerId: params.providerId,
  });

  return {
    api: params.body.api ?? existing.api ?? 'openai-responses',
    base_url: params.body.base_url ?? existing.baseUrl ?? '',
    ...((params.body.api_key ?? existingSecrets.api_key)
      ? {api_key: params.body.api_key ?? existingSecrets.api_key}
      : {}),
    headers: Object.entries(headers.runtimeHeaders).map(([name, value]) => ({name, value})),
  };
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
  const secretHeaderNames: string[] = [];
  const secretCredentials: Record<string, string> = {};
  const runtimeHeaders: Record<string, string> = {};

  for (const header of headers) {
    runtimeHeaders[header.name] = header.value;
    if (header.secret) {
      secretHeaderNames.push(header.name);
      secretCredentials[`header:${header.name}`] = header.value;
    } else {
      plaintextHeaders.push({name: header.name, value: header.value});
    }
  }

  return {plaintextHeaders, secretHeaderNames, secretCredentials, runtimeHeaders};
}

function resolveNextHeaders(params: {
  requestHeaders: UpdateCustomModelProviderHeaderRequestDto[] | undefined;
  existing: ModelProviderConfig;
  existingSecrets: Record<string, string>;
  providerId: ModelProviderRef;
}): {
  plaintextHeaders: CustomModelProviderHeaderDto[];
  secretHeaderNames: string[];
  runtimeHeaders: Record<string, string>;
  probeSecretCredentials: Record<string, string>;
  newSecretCredentials: Record<string, string>;
} {
  if (params.requestHeaders !== undefined) {
    return splitUpdateHeaders({
      requestHeaders: params.requestHeaders,
      existingSecrets: params.existingSecrets,
      providerId: params.providerId,
    });
  }

  const runtimeHeaders: Record<string, string> = {};
  for (const header of params.existing.headers ?? []) {
    runtimeHeaders[header.name] = header.value;
  }

  const probeSecretCredentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.existingSecrets)) {
    if (!key.startsWith('header:')) continue;
    const name = key.slice('header:'.length);
    runtimeHeaders[name] = value;
    probeSecretCredentials[key] = value;
  }

  return {
    plaintextHeaders: params.existing.headers ?? [],
    secretHeaderNames:
      params.existing.secretHeaderNames ?? secretHeaderNamesFromCredentials(params.existingSecrets),
    runtimeHeaders,
    probeSecretCredentials,
    newSecretCredentials: {},
  };
}

function splitUpdateHeaders(params: {
  requestHeaders: UpdateCustomModelProviderHeaderRequestDto[];
  existingSecrets: Record<string, string>;
  providerId: ModelProviderRef;
}): {
  plaintextHeaders: CustomModelProviderHeaderDto[];
  secretHeaderNames: string[];
  runtimeHeaders: Record<string, string>;
  probeSecretCredentials: Record<string, string>;
  newSecretCredentials: Record<string, string>;
} {
  const plaintextHeaders: CustomModelProviderHeaderDto[] = [];
  const secretHeaderNames: string[] = [];
  const runtimeHeaders: Record<string, string> = {};
  const probeSecretCredentials: Record<string, string> = {};
  const newSecretCredentials: Record<string, string> = {};

  for (const header of params.requestHeaders) {
    if (header.keep === true) {
      const key = `header:${header.name}`;
      const value = params.existingSecrets[key];
      if (value === undefined) {
        throw new InvalidCustomModelProviderHeaderKeepError(params.providerId, header.name);
      }
      runtimeHeaders[header.name] = value;
      secretHeaderNames.push(header.name);
      probeSecretCredentials[key] = value;
      newSecretCredentials[key] = value;
      continue;
    }

    const value = header.value;
    if (value === undefined) {
      throw new InvalidCustomModelProviderHeaderKeepError(params.providerId, header.name);
    }
    runtimeHeaders[header.name] = value;
    if (header.secret) {
      const key = `header:${header.name}`;
      secretHeaderNames.push(header.name);
      probeSecretCredentials[key] = value;
      newSecretCredentials[key] = value;
    } else {
      plaintextHeaders.push({name: header.name, value});
    }
  }

  return {
    plaintextHeaders,
    secretHeaderNames,
    runtimeHeaders,
    probeSecretCredentials,
    newSecretCredentials,
  };
}

function resolveNextDefaultModel(
  providerId: ModelProviderRef,
  existingDefaultModel: string | null,
  models: CustomAgentModelDto[],
  body: UpdateCustomModelProviderBodyDto,
): string | null {
  if (!('default_model' in body)) {
    if (existingDefaultModel === null) return null;
    return models.some((model) => model.id === existingDefaultModel) ? existingDefaultModel : null;
  }

  const requestedDefaultModel = body.default_model ?? null;
  if (requestedDefaultModel === null) return null;
  if (models.some((model) => model.id === requestedDefaultModel)) return requestedDefaultModel;
  throw new InvalidAgentModelError('pi', providerId, requestedDefaultModel);
}

function selectProbeModel(
  models: CustomAgentModelDto[],
  defaultModel: string | null,
): CustomAgentModelDto {
  const model = models.find((candidate) => candidate.id === defaultModel) ?? models[0];
  if (!model) throw new Error('Custom model provider must include at least one model.');
  return model;
}

async function getCustomProviderSecrets(
  secrets: AgentSecretsClient,
  params: {
    workspaceId: string;
    providerId: ModelProviderRef;
  },
): Promise<Record<string, string>> {
  const {values} = await secrets.getSecretsByNamespace({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.providerId),
  });
  return storeValuesToCustomRuntimeCredentials(values);
}

function assertStoredSecretsNotReusedAfterBaseUrlChange(params: {
  body: UpdateCustomModelProviderBodyDto | DiscoverCustomModelProviderModelsBySlugBodyDto;
  existing: ModelProviderConfig;
  existingSecrets: Record<string, string>;
  providerId: ModelProviderRef;
}): void {
  if (
    params.body.base_url === undefined ||
    normalizedUrl(params.body.base_url) === normalizedUrl(params.existing.baseUrl ?? '')
  ) {
    return;
  }

  const reusesStoredApiKey =
    params.existingSecrets.api_key !== undefined && params.body.api_key === undefined;
  const reusesStoredSecretHeader =
    params.body.headers === undefined
      ? Object.keys(params.existingSecrets).some((key) => key.startsWith('header:'))
      : params.body.headers.some((header) => header.keep === true);

  if (reusesStoredApiKey || reusesStoredSecretHeader) {
    throw new CustomModelProviderStoredSecretBaseUrlChangeError(params.providerId);
  }
}

function normalizedUrl(value: string): string {
  return normalizeCustomProviderBaseUrl(value);
}

async function rollbackCustomProviderSecretUpdate(
  secrets: AgentSecretsClient,
  params: {
    workspaceId: string;
    namespace: string;
    existingSecrets: Record<string, string>;
    attemptedSecrets: Record<string, string>;
  },
): Promise<void> {
  const attemptedKeys = Object.keys(params.attemptedSecrets);
  if (attemptedKeys.length === 0) return;

  const secretsToRestore = Object.fromEntries(
    attemptedKeys.flatMap((key) => {
      const value = params.existingSecrets[key];
      return value === undefined ? [] : [[key, value]];
    }),
  );
  if (Object.keys(secretsToRestore).length > 0) {
    await secrets.setSecrets({
      workspaceId: params.workspaceId,
      namespace: params.namespace,
      values: customCredentialsToStoreValues(secretsToRestore),
    });
  }

  const newKeys = attemptedKeys.filter((key) => params.existingSecrets[key] === undefined);
  if (newKeys.length === 0) return;

  await secrets.deleteSecrets({
    workspaceId: params.workspaceId,
    namespace: params.namespace,
    keys: newKeys.map(customCredentialToStoreKey),
  });
}

async function pruneStaleCustomHeaderSecrets(
  secrets: AgentSecretsClient,
  params: {
    workspaceId: string;
    providerId: ModelProviderRef;
    existingSecrets: Record<string, string>;
    newSecrets: Record<string, string>;
    replaceHeaders: boolean;
  },
): Promise<void> {
  if (!params.replaceHeaders) return;

  const nextKeys = new Set(Object.keys(params.newSecrets));
  const staleKeys = Object.keys(params.existingSecrets).filter(
    (key) => key.startsWith('header:') && !nextKeys.has(key),
  );
  if (staleKeys.length === 0) return;

  await secrets.deleteSecrets({
    workspaceId: params.workspaceId,
    namespace: agentSystemNamespace(params.providerId),
    keys: staleKeys.map(customCredentialToStoreKey),
  });
}

function secretHeaderNamesFromCredentials(credentials: Record<string, string>): string[] {
  return Object.keys(credentials)
    .filter((key) => key.startsWith('header:'))
    .map((key) => key.slice('header:'.length))
    .sort();
}
