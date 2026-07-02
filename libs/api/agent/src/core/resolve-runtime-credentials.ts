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
  modelProvider: ModelProviderRef;
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
    modelProviderId: params.modelProvider,
  });

  if (providerConfig) {
    try {
      const credentials = decryptCredentials({
        workspaceId: params.workspaceId,
        modelProviderId: params.modelProvider,
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

  const instanceCredentials = instanceFallbackCredentials(params.modelProvider, runtimeConfig);
  if (instanceCredentials) {
    agentRuntimeConfigResolvedCount.add(1, {source: 'instance', outcome: 'resolved'});
    return toResponse(params, instanceCredentials);
  }

  agentRuntimeConfigResolvedCount.add(1, {
    source:
      params.modelProvider === runtimeConfig.AGENT_DEFAULT_PROVIDER ? 'instance' : 'workspace',
    outcome: 'unavailable',
  });
  throw new ModelProviderConfigNotFoundError(params.workspaceId, params.modelProvider);
}

export function getInstanceDefaultModelProviderApiKeyField(
  modelProviderId: ModelProviderRef,
): 'api_key' | undefined {
  const credentialFields =
    getModelProviderEntry(modelProviderId as SupportedModelProviderId)?.credential_fields ?? [];
  const field = credentialFields[0];
  if (credentialFields.length !== 1 || field?.key !== 'api_key' || !field.secret) {
    return undefined;
  }
  return 'api_key';
}

function instanceFallbackCredentials(
  modelProviderId: ModelProviderRef,
  runtimeConfig: RuntimeCredentialsConfig,
): Record<string, string> | undefined {
  const instanceApiKey = runtimeConfig.AGENT_DEFAULT_PROVIDER_API_KEY;
  if (modelProviderId !== runtimeConfig.AGENT_DEFAULT_PROVIDER || !instanceApiKey) return undefined;

  const fieldKey = getInstanceDefaultModelProviderApiKeyField(modelProviderId);
  if (!fieldKey) return undefined;

  return {[fieldKey]: instanceApiKey};
}

function toResponse(
  params: ResolveRuntimeCredentialsParams,
  credentials: Record<string, string>,
): AgentRuntimeCredentialsResponseDto {
  return {
    model_provider_id: params.modelProvider,
    model: params.model,
    thinking: params.thinking,
    credentials,
  };
}
