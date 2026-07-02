import {
  type AgentRuntimeCredentialsResponseDto,
  type AgentThinking,
  getModelProviderEntry,
  type ModelProviderRef,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {config} from '#config.js';
import {getModelProviderConfig} from '#db/index.js';
import {agentRuntimeConfigResolvedCount} from '#metrics/index.js';
import {decryptCredentials} from './credential-encryption.js';
import {CredentialDecryptionError, ModelProviderConfigNotFoundError} from './errors.js';

export interface ResolveRuntimeCredentialsParams {
  workspaceId: string;
  provider: ModelProviderRef;
  model: string;
  thinking: AgentThinking;
}

interface RuntimeCredentialsConfig {
  AGENT_DEFAULT_PROVIDER?: SupportedModelProviderId | undefined;
  AGENT_DEFAULT_PROVIDER_API_KEY?: string | undefined;
}

export async function resolveRuntimeCredentials(
  params: ResolveRuntimeCredentialsParams,
  runtimeConfig: RuntimeCredentialsConfig = config,
): Promise<AgentRuntimeCredentialsResponseDto> {
  const providerConfig = await getModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.provider,
  });

  if (providerConfig) {
    try {
      const credentials = decryptCredentials({
        workspaceId: params.workspaceId,
        providerId: params.provider,
        encryptedCredentials: providerConfig.encryptedCredentials,
      });

      agentRuntimeConfigResolvedCount.add(1, {source: 'workspace', outcome: 'resolved'});
      return toResponse(params, credentials);
    } catch (error) {
      if (error instanceof CredentialDecryptionError) {
        agentRuntimeConfigResolvedCount.add(1, {
          source: 'workspace',
          outcome: 'decryption_failed',
        });
      }
      throw error;
    }
  }

  const instanceCredentials = instanceFallbackCredentials(params.provider, runtimeConfig);
  if (instanceCredentials) {
    agentRuntimeConfigResolvedCount.add(1, {source: 'instance', outcome: 'resolved'});
    return toResponse(params, instanceCredentials);
  }

  agentRuntimeConfigResolvedCount.add(1, {
    source: params.provider === runtimeConfig.AGENT_DEFAULT_PROVIDER ? 'instance' : 'workspace',
    outcome: 'unavailable',
  });
  throw new ModelProviderConfigNotFoundError(params.workspaceId, params.provider);
}

export function getInstanceDefaultModelProviderApiKeyField(
  providerId: ModelProviderRef,
): 'api_key' | undefined {
  const credentialFields =
    getModelProviderEntry(providerId as SupportedModelProviderId)?.credential_fields ?? [];
  const field = credentialFields[0];
  if (credentialFields.length !== 1 || field?.key !== 'api_key' || !field.secret) {
    return undefined;
  }
  return 'api_key';
}

function instanceFallbackCredentials(
  providerId: ModelProviderRef,
  runtimeConfig: RuntimeCredentialsConfig,
): Record<string, string> | undefined {
  const instanceApiKey = runtimeConfig.AGENT_DEFAULT_PROVIDER_API_KEY;
  if (providerId !== runtimeConfig.AGENT_DEFAULT_PROVIDER || !instanceApiKey) return undefined;

  const fieldKey = getInstanceDefaultModelProviderApiKeyField(providerId);
  if (!fieldKey) return undefined;

  return {[fieldKey]: instanceApiKey};
}

function toResponse(
  params: ResolveRuntimeCredentialsParams,
  credentials: Record<string, string>,
): AgentRuntimeCredentialsResponseDto {
  return {
    provider_id: params.provider,
    model: params.model,
    thinking: params.thinking,
    credentials,
  };
}
