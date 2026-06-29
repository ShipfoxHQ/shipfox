import type {AgentProviderConfigDto} from '@shipfox/api-agent-dto';
import type {AgentProviderConfig} from '#core/index.js';

export function toAgentProviderConfigDto(config: AgentProviderConfig): AgentProviderConfigDto {
  return {
    provider_id: config.providerId,
    default_model: config.defaultModel,
    key_fingerprints: config.keyFingerprints,
    created_at: config.createdAt.toISOString(),
    updated_at: config.updatedAt.toISOString(),
  };
}
