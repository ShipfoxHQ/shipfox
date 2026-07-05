import {
  type AgentRuntimeCredentialsResponseDto,
  type AgentThinking,
  getModelProviderEntry,
  type Harness,
  type ModelProviderRef,
  modelProviderCredentialKeysMatch,
  type SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {getSecretsByNamespace, SecretDecryptionError} from '@shipfox/api-secrets';
import {config} from '#config.js';
import {getModelProviderConfig} from '#db/index.js';
import {agentRuntimeConfigResolvedCount} from '#metrics/index.js';
import {
  agentSystemNamespace,
  storeValuesToCustomRuntimeCredentials,
  storeValuesToRuntimeCredentials,
} from './credential-fingerprints.js';
import type {ModelProviderConfig} from './entities/model-provider-config.js';
import {ModelProviderConfigNotFoundError} from './errors.js';

export interface ResolveRuntimeCredentialsParams {
  workspaceId: string;
  harness: Harness;
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
  options?: ResolveRuntimeCredentialsOptions,
): Promise<AgentRuntimeCredentialsResponseDto> {
  const runtimeConfig = options?.runtimeConfig ?? config;
  const getCredentialBag = options?.getCredentialBag ?? getSecretsByNamespace;
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
      if (providerConfig.kind === 'custom') {
        const credentials = storeValuesToCustomRuntimeCredentials(values);
        agentRuntimeConfigResolvedCount.add(1, {source: 'workspace', outcome: 'resolved'});
        return toResponse(params, credentials, providerConfig);
      }

      const providerId = params.provider as SupportedModelProviderId;
      const credentials = storeValuesToRuntimeCredentials(providerId, values);
      if (!modelProviderCredentialKeysMatch(providerId, credentials)) {
        throw new ModelProviderConfigNotFoundError(params.workspaceId, params.provider);
      }
      agentRuntimeConfigResolvedCount.add(1, {source: 'workspace', outcome: 'resolved'});
      return toResponse(params, credentials, providerConfig);
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
  providerConfig?: ModelProviderConfig | undefined,
): AgentRuntimeCredentialsResponseDto {
  const response: AgentRuntimeCredentialsResponseDto = {
    harness: params.harness,
    provider_id: params.provider,
    model: params.model,
    thinking: params.thinking,
    credentials,
  };

  if (providerConfig?.kind === 'custom') {
    response.custom_provider = {
      api: providerConfig.api ?? 'openai-responses',
      base_url: providerConfig.baseUrl ?? '',
      headers: providerConfig.headers ?? [],
      secret_header_names: Object.keys(credentials)
        .filter((key) => key.startsWith('header:'))
        .map((key) => key.slice('header:'.length))
        .sort(),
      models: providerConfig.models ?? [],
      requires_api_key: providerConfig.requiresApiKey,
    };
  }

  return response;
}
