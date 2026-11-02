import {getApiProvider} from '@earendil-works/pi-ai/compat';
import type {ModelRuntime} from '@earendil-works/pi-coding-agent';
import {
  type CustomAgentModelDto,
  type CustomModelProviderRuntimeConfigDto,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_INPUT_IMAGE,
  DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_MODEL_REASONING,
} from '@shipfox/api-agent-dto';
import {AgentConfigError} from '#errors.js';
import {wrapManagedProviderStream} from '#provider-stream-recovery.js';

const KEYLESS_CUSTOM_PROVIDER_API_KEY = 'shipfox-keyless-custom-provider-placeholder';
const SECRET_HEADER_CREDENTIAL_PREFIX = 'header:';

export type ModelRuntimeInstance = Awaited<ReturnType<typeof ModelRuntime.create>>;
type CustomProviderConfig = Parameters<ModelRuntimeInstance['registerProvider']>[1];
type CustomProviderModel = NonNullable<CustomProviderConfig['models']>[number];

/**
 * Checks that a custom provider endpoint may be called. Each host supplies its own policy and
 * translates a denial to an `AgentConfigError`.
 */
export type AssertEgressAllowed = (url: string, blockedTargetLabel: string) => Promise<void>;

export async function registerCustomProvider({
  modelRuntime,
  provider,
  credentials,
  customProvider,
  assertEgressAllowed,
}: {
  modelRuntime: ModelRuntimeInstance;
  provider: string;
  credentials: Record<string, string>;
  customProvider: CustomModelProviderRuntimeConfigDto;
  assertEgressAllowed: AssertEgressAllowed;
}): Promise<void> {
  // Redirects and DNS changes after this point remain transport-layer SSRF
  // residuals until pi exposes per-request IP pinning hooks.
  await assertEgressAllowed(customProvider.base_url, 'Custom model provider endpoint');

  const apiKey = customProviderApiKey(provider, customProvider, credentials);
  const baseStreamSimple =
    provider === 'shipfox' ? getApiProvider(customProvider.api)?.streamSimple : undefined;

  try {
    modelRuntime.registerProvider(provider, {
      name: provider,
      baseUrl: customProvider.base_url,
      api: customProvider.api,
      apiKey,
      headers: customProviderHeaders(customProvider, credentials),
      models: customProvider.models.map((model) => toPiCustomProviderModel(customProvider, model)),
      ...(baseStreamSimple === undefined
        ? {}
        : {streamSimple: wrapManagedProviderStream(baseStreamSimple)}),
    });
  } catch (error) {
    throw new AgentConfigError(
      error instanceof Error && error.message.length > 0
        ? `Custom model provider "${provider}" is invalid: ${error.message}`
        : `Custom model provider "${provider}" is invalid.`,
      'step_config_invalid',
    );
  }
}

export function customProviderApiKey(
  provider: string,
  customProvider: CustomModelProviderRuntimeConfigDto,
  credentials: Record<string, string>,
): string {
  const apiKey = credentials.api_key;
  if (!customProvider.requires_api_key) return KEYLESS_CUSTOM_PROVIDER_API_KEY;
  if (apiKey !== undefined && apiKey !== '') return apiKey;

  throw new AgentConfigError(
    `Custom model provider "${provider}" requires an API key but none was resolved.`,
    'credentials_invalid',
  );
}

export function customProviderHeaders(
  customProvider: CustomModelProviderRuntimeConfigDto,
  credentials: Record<string, string>,
): Record<string, string> {
  const headers = Object.fromEntries(
    customProvider.headers.map((header) => [header.name, header.value]),
  );

  for (const name of customProvider.secret_header_names) {
    const value = credentials[`${SECRET_HEADER_CREDENTIAL_PREFIX}${name}`];
    if (value === undefined || value === '') continue;
    headers[name] = value;
  }

  return headers;
}

export function toPiCustomProviderModel(
  customProvider: CustomModelProviderRuntimeConfigDto,
  model: CustomAgentModelDto,
): CustomProviderModel {
  const inputImage = model.input_image ?? DEFAULT_CUSTOM_MODEL_INPUT_IMAGE;
  const piModel: CustomProviderModel = {
    id: model.id,
    name: model.label,
    api: customProvider.api,
    reasoning: model.reasoning ?? DEFAULT_CUSTOM_MODEL_REASONING,
    input: inputImage ? ['text', 'image'] : ['text'],
    cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
    contextWindow: model.context_window ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
    maxTokens: model.max_output_tokens ?? DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
    ...(model.thinking_level_map === undefined ? {} : {thinkingLevelMap: model.thinking_level_map}),
    ...(model.compat === undefined ? {} : {compat: model.compat}),
  };
  return piModel;
}
