import type {ModelProviderConfigDto} from '@shipfox/api-agent-dto';
import type {ModelProviderConfig} from '#core/index.js';

export function toModelProviderConfigDto(config: ModelProviderConfig): ModelProviderConfigDto {
  return {
    provider_id: config.providerId,
    default_model: config.defaultModel,
    key_fingerprints: config.keyFingerprints,
    created_at: config.createdAt.toISOString(),
    updated_at: config.updatedAt.toISOString(),
  };
}
