import {type Context, complete, getModels, type ProviderStreamOptions} from '@earendil-works/pi-ai';
import {getAgentProviderEntry, type SupportedAgentProviderId} from '@shipfox/api-agent-dto';
import {redactSecrets, secretWireForms} from '@shipfox/redact';
import {config} from '#config.js';
import {
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  UnsupportedAgentProviderError,
} from './errors.js';

const PROBE_MAX_TOKENS = 64;
const MAX_SANITIZED_ERROR_LENGTH = 500;

export interface ProbeProviderCredentialsParams {
  providerId: SupportedAgentProviderId;
  model: string;
  credentials: Record<string, string>;
  signal?: AbortSignal | undefined;
}

export async function probeProviderCredentials(
  params: ProbeProviderCredentialsParams,
): Promise<void> {
  const entry = getAgentProviderEntry(params.providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedAgentProviderError(params.providerId);
  }

  const model = getModels(params.providerId).find((candidate) => candidate.id === params.model);
  if (!model) throw new InvalidAgentModelError(params.providerId, params.model);

  const secretField = entry.credential_fields.find((field) => field.secret);
  if (!secretField) throw new UnsupportedAgentProviderError(params.providerId);
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
    ...providerCredentialOptions(params),
    ...(params.signal ? {signal: params.signal} : {}),
  };

  await complete(model, context, options);
}

export function sanitizeProviderError(error: unknown, secrets: string[]): string {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : 'Provider validation failed.';
  const secretForms = secrets.flatMap((secret) => secretWireForms(secret));
  const redacted = redactSecrets(message, secretForms);
  return redacted.slice(0, MAX_SANITIZED_ERROR_LENGTH);
}

function providerCredentialOptions(
  params: Pick<ProbeProviderCredentialsParams, 'providerId' | 'credentials'>,
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
  params: Pick<ProbeProviderCredentialsParams, 'providerId' | 'credentials'>,
  key: string,
): string {
  const value = params.credentials[key];
  if (value === undefined) throw new InvalidCredentialFieldsError(params.providerId);
  return value;
}
