import {
  agentProviderCredentialKeysMatch,
  DEFAULT_AGENT_THINKING,
  getAgentProviderEntry,
  type SupportedAgentProviderId,
} from '@shipfox/api-agent-dto';
import {upsertAgentProviderConfig} from '#db/index.js';
import {providerValidationCount} from '#metrics/index.js';
import {encryptCredentials, fingerprintCredentials} from './credential-encryption.js';
import type {AgentProviderConfig} from './entities/agent-provider-config.js';
import {
  AgentProviderValidationError,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ProviderValidationUnavailableError,
  UnsupportedAgentProviderError,
} from './errors.js';
import {probeProviderCredentials, sanitizeProviderError} from './provider-validation.js';

export interface TestAndSaveProviderConfigParams {
  workspaceId: string;
  providerId: SupportedAgentProviderId;
  credentials: Record<string, string>;
}

export interface TestAndSaveProviderConfigOptions {
  probe?: typeof probeProviderCredentials;
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

  if (!hasSingleSecretCredentialField(entry.credential_fields)) {
    throw new ProviderValidationUnavailableError(params.providerId);
  }

  if (!agentProviderCredentialKeysMatch(params.providerId, params.credentials)) {
    throw new InvalidCredentialFieldsError(params.providerId);
  }

  try {
    await probe({
      providerId: params.providerId,
      model: entry.default_model,
      credentials: params.credentials,
    });
  } catch (error) {
    if (error instanceof InvalidAgentModelError) throw error;

    providerValidationCount.add(1, {provider: params.providerId, outcome: 'failed'});
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
    defaultModel: entry.default_model,
    defaultThinking: DEFAULT_AGENT_THINKING,
  });
}

function hasSingleSecretCredentialField(
  credentialFields: {key: string; secret: boolean}[],
): boolean {
  return credentialFields.length === 1 && credentialFields[0]?.secret === true;
}
