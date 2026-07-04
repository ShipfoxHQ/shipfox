import type {
  CreateCustomModelProviderBodyDto,
  CustomModelProviderConfigDto,
  ListModelProviderConfigsResponseDto,
  ModelProviderApi,
  ModelProviderRef,
} from '@shipfox/api-agent-dto';
import {requestJson} from '@shipfox/e2e-core';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'smollm2:135m-instruct-q2_K';
const DEFAULT_OLLAMA_PROVIDER_API: ModelProviderApi = 'openai-completions';
const TRAILING_SLASHES_RE = /\/+$/u;

export interface OllamaConfig {
  baseUrl: string;
  model: string;
  openAiBaseUrl: string;
}

export interface RequireOllamaModelParams {
  baseUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
  model?: string | undefined;
}

export interface CreateOllamaCustomProviderParams {
  workspaceId: string;
  sessionToken: string;
  api?: ModelProviderApi | undefined;
  baseUrl?: string | undefined;
  displayName?: string | undefined;
  model?: string | undefined;
  providerId?: ModelProviderRef | undefined;
}

export interface ListModelProviderConfigsParams {
  workspaceId: string;
  sessionToken: string;
}

export function ollamaConfig(env: NodeJS.ProcessEnv = process.env): OllamaConfig {
  const baseUrl = normalizeBaseUrl(
    env.OLLAMA_BASE_URL || env.SHIPFOX_OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
  );
  return {
    baseUrl,
    model: env.SHIPFOX_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
    openAiBaseUrl: `${baseUrl}/v1`,
  };
}

export async function requireOllamaModel(
  params: RequireOllamaModelParams = {},
): Promise<OllamaConfig> {
  const resolved = ollamaConfig();
  const baseUrl = normalizeBaseUrl(params.baseUrl ?? resolved.baseUrl);
  const model = params.model ?? resolved.model;
  const fetchImpl = params.fetch ?? fetch;
  const tagsUrl = `${baseUrl}/api/tags`;

  let response: Response;
  try {
    response = await fetchImpl(tagsUrl);
  } catch (error) {
    throw new Error(ollamaUnavailableMessage(baseUrl, error));
  }

  if (!response.ok) {
    throw new Error(`Ollama at ${baseUrl} returned ${response.status} for /api/tags. ${ollamaFix}`);
  }

  const modelNames = ollamaModelNames(await response.json());
  if (!modelNames.includes(model)) {
    throw new Error(
      [
        `Ollama model ${model} is not available at ${baseUrl}.`,
        modelNames.length > 0 ? `Available models: ${modelNames.join(', ')}.` : 'No models found.',
        ollamaFix,
      ].join(' '),
    );
  }

  return {baseUrl, model, openAiBaseUrl: `${baseUrl}/v1`};
}

export async function createOllamaCustomProvider(
  params: CreateOllamaCustomProviderParams,
): Promise<CustomModelProviderConfigDto> {
  const ollama = await requireOllamaModel({
    baseUrl: params.baseUrl,
    model: params.model,
  });
  const providerId = params.providerId ?? createOllamaProviderId();
  const body = createOllamaCustomProviderBody({
    api: params.api ?? DEFAULT_OLLAMA_PROVIDER_API,
    baseUrl: ollama.openAiBaseUrl,
    displayName: params.displayName ?? 'Local Ollama',
    model: ollama.model,
    providerId,
  });

  return await requestJson<CustomModelProviderConfigDto>(
    'post',
    `/workspaces/${params.workspaceId}/agent/custom-model-providers`,
    {
      headers: {authorization: `Bearer ${params.sessionToken}`},
      json: body,
    },
  );
}

export async function listModelProviderConfigs(
  params: ListModelProviderConfigsParams,
): Promise<ListModelProviderConfigsResponseDto> {
  return await requestJson<ListModelProviderConfigsResponseDto>(
    'get',
    `/workspaces/${params.workspaceId}/agent/model-providers`,
    {
      headers: {authorization: `Bearer ${params.sessionToken}`},
    },
  );
}

export function createAgentHelper() {
  return {
    createOllamaCustomProvider,
    listModelProviderConfigs,
    requireOllamaModel,
  };
}

export type AgentHelper = ReturnType<typeof createAgentHelper>;

export interface AgentFixtures {
  agent: AgentHelper;
}

export const agentHelper = {
  agent: async (
    {request: _request}: {request: unknown},
    use: (helper: AgentHelper) => Promise<void>,
  ) => {
    await use(createAgentHelper());
  },
};

function createOllamaCustomProviderBody(params: {
  api: ModelProviderApi;
  baseUrl: string;
  displayName: string;
  model: string;
  providerId: ModelProviderRef;
}): CreateCustomModelProviderBodyDto {
  return {
    slug: params.providerId,
    display_name: params.displayName,
    api: params.api,
    base_url: params.baseUrl,
    models: [{id: params.model, label: params.model}],
    default_model: params.model,
  };
}

function createOllamaProviderId(): ModelProviderRef {
  return `local-ollama-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(TRAILING_SLASHES_RE, '');
}

function ollamaModelNames(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const models = (payload as {models?: unknown}).models;
  if (!Array.isArray(models)) return [];

  return models.flatMap((model) => {
    if (!model || typeof model !== 'object') return [];
    const record = model as {model?: unknown; name?: unknown};
    const name = typeof record.name === 'string' ? record.name : undefined;
    const modelName = typeof record.model === 'string' ? record.model : undefined;
    return [...new Set([name, modelName].filter((value): value is string => Boolean(value)))];
  });
}

const ollamaFix = 'Run `mise run ollama:up` before running agent E2E tests.';

function ollamaUnavailableMessage(baseUrl: string, error: unknown): string {
  const reason = error instanceof Error ? ` ${error.message}` : '';
  return `Could not reach Ollama at ${baseUrl}.${reason} ${ollamaFix}`;
}
