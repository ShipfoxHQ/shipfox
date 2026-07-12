import type {
  CreateCustomModelProviderBodyDto,
  CustomAgentModelDto,
  CustomModelProviderConfigDto,
  ListModelProviderConfigsResponseDto,
  ModelProviderApi,
  ModelProviderRef,
} from '@shipfox/api-agent-dto';
import {createApiClient, requestJson} from '@shipfox/e2e-core';

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_OLLAMA_MODEL = 'smollm2:135m-instruct-q2_K';
const DEFAULT_ANTHROPIC_FAKE_MODEL = 'deterministic-claude-agent';
const DEFAULT_ANTHROPIC_CONFIG_MODEL = 'claude-opus-4-8';
const OPENAI_COMPATIBLE_PROVIDER_API: ModelProviderApi = 'openai-completions';
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
  baseUrl?: string | undefined;
  displayName?: string | undefined;
  model?: string | undefined;
  modelMetadata?: OpenAiCompatibleCustomProviderModelMetadata | undefined;
  providerId?: ModelProviderRef | undefined;
}

export interface CreateOpenAiCompatibleCustomProviderParams {
  workspaceId: string;
  sessionToken: string;
  baseUrl: string;
  displayName: string;
  model: string;
  providerId: ModelProviderRef;
  modelMetadata?: OpenAiCompatibleCustomProviderModelMetadata | undefined;
}

export type OpenAiCompatibleCustomProviderModelMetadata = Omit<CustomAgentModelDto, 'id' | 'label'>;

export interface ListModelProviderConfigsParams {
  workspaceId: string;
  sessionToken: string;
}

export interface CreateAnthropicModelProviderConfigParams {
  workspaceId: string;
  apiKey?: string | undefined;
  defaultModel?: string | undefined;
  setAsDefault?: boolean | undefined;
}

export interface CreateAnthropicFakeModelProviderConfigParams {
  workspaceId: string;
  fakeModelProvider: FakeModelProviderScriptCreator;
  scriptId: string;
  responses: FakeModelProviderResponse[];
  assertions?: FakeModelProviderRequestAssertion[] | undefined;
  model?: string | undefined;
  configDefaultModel?: string | undefined;
  smallFastModel?: string | undefined;
  setAsDefault?: boolean | undefined;
}

export interface AnthropicFakeModelProviderConfig {
  script: FakeModelProviderScriptHandle;
  runnerEnv: Record<
    | 'AGENT_CLAUDE_ANTHROPIC_BASE_URL'
    | 'AGENT_CLAUDE_ANTHROPIC_MODEL'
    | 'AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL',
    string
  >;
}

export interface FakeModelProviderScriptCreator {
  createScript(params: FakeModelProviderScript): Promise<FakeModelProviderScriptHandle>;
}

export interface FakeModelProviderScript {
  id: string;
  model: string;
  responses: FakeModelProviderResponse[];
  assertions?: FakeModelProviderRequestAssertion[] | undefined;
}

export type FakeModelProviderResponse =
  | {
      kind: 'tool_call';
      toolName: string;
      arguments: Record<string, unknown>;
      content?: string | undefined;
    }
  | {
      kind: 'message';
      content: string;
    }
  | {
      kind: 'error';
      status: number;
      message: string;
    };

export type FakeModelProviderRequestAssertion = (
  | {
      kind: 'model';
      equals: string;
    }
  | {
      kind: 'tool_present';
      name: string;
    }
  | {
      kind: 'tool_absent';
      name: string;
    }
  | {
      kind: 'message_content_includes';
      value: string;
    }
) & {minRequestIndex?: number | undefined};

export interface FakeModelProviderScriptHandle {
  id: string;
  model: string;
  anthropicBaseUrl: string;
  modelProviderBaseUrl: string;
}

export interface DeleteModelProviderConfigParams {
  workspaceId: string;
  sessionToken: string;
  providerId: ModelProviderRef;
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

export async function createOpenAiCompatibleCustomProvider(
  params: CreateOpenAiCompatibleCustomProviderParams,
): Promise<CustomModelProviderConfigDto> {
  const body = createOpenAiCompatibleCustomProviderBody(params);
  const client = createApiClient({token: params.sessionToken});

  return await client.requestJson<CustomModelProviderConfigDto>(
    'post',
    `/workspaces/${params.workspaceId}/agent/custom-model-providers`,
    {json: body},
  );
}

export async function createOllamaCustomProvider(
  params: CreateOllamaCustomProviderParams,
): Promise<CustomModelProviderConfigDto> {
  const ollama = await requireOllamaModel({
    baseUrl: params.baseUrl,
    model: params.model,
  });
  const providerId = params.providerId ?? createOllamaProviderId();
  return await createOpenAiCompatibleCustomProvider({
    baseUrl: ollama.openAiBaseUrl,
    displayName: params.displayName ?? 'Local Ollama',
    model: ollama.model,
    modelMetadata: params.modelMetadata,
    providerId,
    sessionToken: params.sessionToken,
    workspaceId: params.workspaceId,
  });
}

export async function listModelProviderConfigs(
  params: ListModelProviderConfigsParams,
): Promise<ListModelProviderConfigsResponseDto> {
  const client = createApiClient({token: params.sessionToken});

  return await client.requestJson<ListModelProviderConfigsResponseDto>(
    'get',
    `/workspaces/${params.workspaceId}/agent/model-providers`,
  );
}

export async function createAnthropicModelProviderConfig(
  params: CreateAnthropicModelProviderConfigParams,
): Promise<void> {
  await requestJson('post', '/__e2e/agent/model-provider', {
    json: {
      workspace_id: params.workspaceId,
      provider_id: 'anthropic',
      api_key: params.apiKey ?? 'sk-e2e-anthropic-placeholder',
      ...(params.defaultModel !== undefined ? {default_model: params.defaultModel} : {}),
      ...(params.setAsDefault !== undefined ? {set_as_default: params.setAsDefault} : {}),
    },
  });
}

export async function createAnthropicFakeModelProviderConfig(
  params: CreateAnthropicFakeModelProviderConfigParams,
): Promise<AnthropicFakeModelProviderConfig> {
  const model = params.model ?? DEFAULT_ANTHROPIC_FAKE_MODEL;
  const smallFastModel = params.smallFastModel ?? `${model}-small-fast`;
  const script = await params.fakeModelProvider.createScript({
    id: params.scriptId,
    model,
    responses: params.responses,
    assertions: params.assertions,
  });

  await createAnthropicModelProviderConfig({
    workspaceId: params.workspaceId,
    defaultModel: params.configDefaultModel ?? DEFAULT_ANTHROPIC_CONFIG_MODEL,
    setAsDefault: params.setAsDefault,
  });

  return {
    script,
    runnerEnv: {
      AGENT_CLAUDE_ANTHROPIC_BASE_URL: script.anthropicBaseUrl,
      AGENT_CLAUDE_ANTHROPIC_MODEL: script.model,
      AGENT_CLAUDE_ANTHROPIC_SMALL_FAST_MODEL: smallFastModel,
    },
  };
}

export async function deleteModelProviderConfig(
  params: DeleteModelProviderConfigParams,
): Promise<void> {
  const client = createApiClient({token: params.sessionToken});

  await client.requestJson(
    'delete',
    `/workspaces/${params.workspaceId}/agent/model-providers/${params.providerId}`,
  );
}

export function createAgentHelper() {
  return {
    createAnthropicFakeModelProviderConfig,
    createAnthropicModelProviderConfig,
    createOpenAiCompatibleCustomProvider,
    createOllamaCustomProvider,
    deleteModelProviderConfig,
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

function createOpenAiCompatibleCustomProviderBody(params: {
  baseUrl: string;
  displayName: string;
  model: string;
  modelMetadata?: OpenAiCompatibleCustomProviderModelMetadata | undefined;
  providerId: ModelProviderRef;
}): CreateCustomModelProviderBodyDto {
  const model = {
    id: params.model,
    label: params.model,
    ...params.modelMetadata,
  };

  return {
    slug: params.providerId,
    display_name: params.displayName,
    api: OPENAI_COMPATIBLE_PROVIDER_API,
    base_url: params.baseUrl,
    models: [model],
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
