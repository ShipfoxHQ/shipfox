import type {
  CustomModelProviderConfigDto,
  ModelProviderConfigDto,
  ModelProviderConfigResponseDto,
} from '@shipfox/api-agent-dto';
import type {ModelProviderConfig} from '#core/index.js';

export function toModelProviderConfigDto(config: ModelProviderConfig): ModelProviderConfigDto {
  return {
    kind: 'builtin',
    provider_id: config.providerId,
    default_model: config.defaultModel,
    key_fingerprints: config.keyFingerprints,
    created_at: config.createdAt.toISOString(),
    updated_at: config.updatedAt.toISOString(),
  };
}

export function toCustomModelProviderConfigDto(
  config: ModelProviderConfig,
): CustomModelProviderConfigDto {
  return {
    kind: 'custom',
    provider_id: config.providerId,
    display_name: config.displayName ?? config.providerId,
    api: config.api ?? 'openai-responses',
    base_url: config.baseUrl ?? '',
    headers: config.headers ?? [],
    secret_header_names: Object.keys(config.keyFingerprints)
      .filter((key) => key.startsWith('header:'))
      .map((key) => key.slice('header:'.length))
      .sort(),
    models: config.models ?? [],
    default_model: config.defaultModel,
    key_fingerprints: config.keyFingerprints,
    created_at: config.createdAt.toISOString(),
    updated_at: config.updatedAt.toISOString(),
  };
}

export function toModelProviderConfigResponseDto(
  config: ModelProviderConfig,
): ModelProviderConfigResponseDto {
  if (config.kind === 'custom') return toCustomModelProviderConfigDto(config);
  return toModelProviderConfigDto(config);
}
