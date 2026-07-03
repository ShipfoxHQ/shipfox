import {
  type AssistantMessage,
  type Context,
  complete,
  getModels,
  type Model,
  type ProviderStreamOptions,
} from '@earendil-works/pi-ai';
import {
  type CustomAgentModelDto,
  DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
  DEFAULT_CUSTOM_MODEL_INPUT_IMAGE,
  DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  DEFAULT_CUSTOM_MODEL_REASONING,
  getModelProviderEntry,
  type ModelProviderApi,
  type ModelProviderRef,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {redactSecrets, secretWireForms} from '@shipfox/redact';
import {config} from '#config.js';
import {modelProviderValidationCount} from '#metrics/index.js';
import {type EgressPolicy, parseEgressHostDenylist} from './egress-guard.js';
import {
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ModelProviderValidationError,
  ModelProviderValidationUnavailableError,
  UnsupportedModelProviderError,
} from './errors.js';

const PROBE_MAX_TOKENS = 64;
const MAX_SANITIZED_ERROR_LENGTH = 500;
const KEYLESS_CUSTOM_PROVIDER_API_KEY = 'shipfox-custom-provider-keyless-probe';

export interface ProbeModelProviderCredentialsParams {
  providerId: SupportedModelProviderId;
  model: string;
  credentials: Record<string, string>;
  signal?: AbortSignal | undefined;
}

export interface ProbeCustomModelProviderCredentialsParams {
  providerId: ModelProviderRef;
  api: ModelProviderApi;
  baseUrl: string;
  model: CustomAgentModelDto;
  apiKey?: string | undefined;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
}

export interface RunProviderProbeParams<TArgs> {
  probe: (args: TArgs) => Promise<void>;
  args: TArgs;
  metricLabel: SupportedModelProviderId | 'custom';
  providerId: ModelProviderRef;
  secrets: string[];
  signal?: AbortSignal | undefined;
}

export async function runProviderProbe<TArgs>(
  params: RunProviderProbeParams<TArgs>,
): Promise<void> {
  try {
    await params.probe(params.args);
  } catch (error) {
    if (params.signal?.aborted) throw error;
    modelProviderValidationCount.add(1, {
      model_provider: params.metricLabel,
      outcome: 'failed',
    });
    if (error instanceof InvalidAgentModelError) throw error;

    const sanitizedMessage = sanitizeModelProviderError(error, params.secrets);
    throw new ModelProviderValidationError(params.providerId, sanitizedMessage);
  }

  modelProviderValidationCount.add(1, {
    model_provider: params.metricLabel,
    outcome: 'succeeded',
  });
}

export async function probeModelProviderCredentials(
  params: ProbeModelProviderCredentialsParams,
): Promise<void> {
  const entry = getModelProviderEntry(params.providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(params.providerId);
  }

  const model = getModels(params.providerId).find((candidate) => candidate.id === params.model);
  if (!model) throw new InvalidAgentModelError(params.providerId, params.model);

  const secretField = entry.credential_fields.find((field) => field.secret);
  if (!secretField) throw new ModelProviderValidationUnavailableError(params.providerId);
  const apiKey = credentialValue(params, secretField.key);

  const context: Context = {
    messages: [
      {
        role: 'user',
        content: 'Reply with OK.',
        timestamp: Date.now(),
      },
    ],
  };
  const options: ProviderStreamOptions = {
    apiKey,
    maxTokens: PROBE_MAX_TOKENS,
    maxRetries: 0,
    timeoutMs: config.AGENT_PROVIDER_VALIDATION_TIMEOUT_MS,
    ...modelProviderCredentialOptions(params),
    ...(params.signal ? {signal: params.signal} : {}),
  };

  const result = await complete(model, context, options);
  rejectModelProviderErrorResult(result);
}

export async function probeCustomModelProviderCredentials(
  params: ProbeCustomModelProviderCredentialsParams,
): Promise<void> {
  const context: Context = {
    messages: [
      {
        role: 'user',
        content: 'Reply with OK.',
        timestamp: Date.now(),
      },
    ],
  };
  const options: ProviderStreamOptions = {
    apiKey: params.apiKey ?? KEYLESS_CUSTOM_PROVIDER_API_KEY,
    maxTokens: PROBE_MAX_TOKENS,
    maxRetries: 0,
    timeoutMs: config.AGENT_PROVIDER_VALIDATION_TIMEOUT_MS,
    ...(params.headers ? {headers: params.headers} : {}),
    ...(params.signal ? {signal: params.signal} : {}),
  };

  const result = await complete(buildCustomProbeModel(params), context, options);
  rejectModelProviderErrorResult(result);
}

export function sanitizeModelProviderError(error: unknown, secrets: string[]): string {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : 'Provider validation failed.';
  const secretForms = secrets.flatMap((secret) => secretWireForms(secret));
  const redacted = redactSecrets(message, secretForms);
  return redacted.slice(0, MAX_SANITIZED_ERROR_LENGTH);
}

export function egressPolicy(): EgressPolicy {
  return {
    allowPrivateNetworks: config.AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS,
    hostDenylist: parseEgressHostDenylist(config.AGENT_CUSTOM_PROVIDER_HOST_DENYLIST),
  };
}

function buildCustomProbeModel(
  params: ProbeCustomModelProviderCredentialsParams,
): Model<ModelProviderApi> {
  const input: ('text' | 'image')[] = ['text'];
  if (params.model.input_image ?? DEFAULT_CUSTOM_MODEL_INPUT_IMAGE) {
    input.push('image');
  }

  return {
    id: params.model.id,
    name: params.model.label,
    api: params.api,
    provider: params.providerId,
    baseUrl: params.baseUrl,
    reasoning: params.model.reasoning ?? DEFAULT_CUSTOM_MODEL_REASONING,
    input,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: params.model.context_window ?? DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW,
    maxTokens: params.model.max_output_tokens ?? DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS,
  };
}

function modelProviderCredentialOptions(
  params: Pick<ProbeModelProviderCredentialsParams, 'providerId' | 'credentials'>,
): ProviderStreamOptions {
  switch (params.providerId) {
    case 'azure-openai-responses':
      return {azureBaseUrl: credentialValue(params, 'endpoint')};
    case 'cloudflare-ai-gateway':
      return {
        env: {
          CLOUDFLARE_ACCOUNT_ID: credentialValue(params, 'account_id'),
          CLOUDFLARE_GATEWAY_ID: credentialValue(params, 'gateway_id'),
        },
      };
    case 'cloudflare-workers-ai':
      return {
        env: {
          CLOUDFLARE_ACCOUNT_ID: credentialValue(params, 'account_id'),
        },
      };
    default:
      return {};
  }
}

function credentialValue(
  params: Pick<ProbeModelProviderCredentialsParams, 'providerId' | 'credentials'>,
  key: string,
): string {
  const value = params.credentials[key];
  if (value === undefined) throw new InvalidCredentialFieldsError(params.providerId);
  return value;
}

function rejectModelProviderErrorResult(result: AssistantMessage): void {
  if (result.stopReason !== 'error' && result.stopReason !== 'aborted') return;
  throw new Error(result.errorMessage ?? 'Provider validation failed.');
}
