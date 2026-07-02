import {
  type AssistantMessage,
  type Context,
  complete,
  getModels,
  type ProviderStreamOptions,
} from '@earendil-works/pi-ai';
import {getModelProviderEntry, type SupportedModelProviderId} from '@shipfox/api-agent-dto';
import {redactSecrets, secretWireForms} from '@shipfox/redact';
import {config} from '#config.js';
import {
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ModelProviderValidationUnavailableError,
  UnsupportedModelProviderError,
} from './errors.js';

const PROBE_MAX_TOKENS = 64;
const MAX_SANITIZED_ERROR_LENGTH = 500;

export interface ProbeModelProviderCredentialsParams {
  modelProviderId: SupportedModelProviderId;
  model: string;
  credentials: Record<string, string>;
  signal?: AbortSignal | undefined;
}

export async function probeModelProviderCredentials(
  params: ProbeModelProviderCredentialsParams,
): Promise<void> {
  const entry = getModelProviderEntry(params.modelProviderId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(params.modelProviderId);
  }

  const model = getModels(params.modelProviderId).find(
    (candidate) => candidate.id === params.model,
  );
  if (!model) throw new InvalidAgentModelError(params.modelProviderId, params.model);

  const secretField = entry.credential_fields.find((field) => field.secret);
  if (!secretField) throw new ModelProviderValidationUnavailableError(params.modelProviderId);
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

export function sanitizeModelProviderError(error: unknown, secrets: string[]): string {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : 'Model provider validation failed.';
  const secretForms = secrets.flatMap((secret) => secretWireForms(secret));
  const redacted = redactSecrets(message, secretForms);
  return redacted.slice(0, MAX_SANITIZED_ERROR_LENGTH);
}

function modelProviderCredentialOptions(
  params: Pick<ProbeModelProviderCredentialsParams, 'modelProviderId' | 'credentials'>,
): ProviderStreamOptions {
  switch (params.modelProviderId) {
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
  params: Pick<ProbeModelProviderCredentialsParams, 'modelProviderId' | 'credentials'>,
  key: string,
): string {
  const value = params.credentials[key];
  if (value === undefined) throw new InvalidCredentialFieldsError(params.modelProviderId);
  return value;
}

function rejectModelProviderErrorResult(result: AssistantMessage): void {
  if (result.stopReason !== 'error' && result.stopReason !== 'aborted') return;
  throw new Error(result.errorMessage ?? 'Model provider validation failed.');
}
