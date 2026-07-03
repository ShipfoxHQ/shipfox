import {
  type AgentRuntimeCredentialsResponseDto,
  type AgentThinking,
  getModelProviderEntry,
  type ModelProviderRef,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {getSecretsByNamespace, SecretDecryptionError} from '@shipfox/api-secrets';
import {config} from '#config.js';
import {getModelProviderConfig} from '#db/index.js';
import {agentRuntimeConfigResolvedCount} from '#metrics/index.js';
import {agentSystemNamespace, storeValuesToRuntimeCredentials} from './credential-fingerprints.js';
import {ModelProviderConfigNotFoundError} from './errors.js';

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

interface ResolveRuntimeCredentialsOptions {
  runtimeConfig?: RuntimeCredentialsConfig | undefined;
  getCredentialBag?: typeof getSecretsByNamespace | undefined;
}

export async function resolveRuntimeCredentials(
  params: ResolveRuntimeCredentialsParams,
  options?: RuntimeCredentialsConfig | ResolveRuntimeCredentialsOptions,
): Promise<AgentRuntimeCredentialsResponseDto> {
  const runtimeConfig =
    options === undefined
      ? config
      : isOptions(options)
        ? (options.runtimeConfig ?? config)
        : options;
  const getCredentialBag =
    options !== undefined && isOptions(options)
      ? (options.getCredentialBag ?? getSecretsByNamespace)
      : getSecretsByNamespace;
  const providerConfig = await getModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.provider,
  });

  if (providerConfig) {
    try {
      const values = await getCredentialBag({
        workspaceId: params.workspaceId,
        namespace: agentSystemNamespace(params.provider),
      });
      const credentials = storeValuesToRuntimeCredentials(
        params.provider as SupportedModelProviderId,
        values,
      );
      if (Object.keys(credentials).length === 0) {
        throw new ModelProviderConfigNotFoundError(params.workspaceId, params.provider);
      }

      agentRuntimeConfigResolvedCount.add(1, {source: 'workspace', outcome: 'resolved'});
      return toResponse(params, credentials);
    } catch (error) {
      if (error instanceof SecretDecryptionError) {
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

function isOptions(
  value: RuntimeCredentialsConfig | ResolveRuntimeCredentialsOptions,
): value is ResolveRuntimeCredentialsOptions {
  return 'runtimeConfig' in value || 'getCredentialBag' in value;
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
