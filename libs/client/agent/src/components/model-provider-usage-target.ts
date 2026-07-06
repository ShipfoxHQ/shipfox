import type {
  CustomModelProviderConfigDto,
  ModelProviderCatalogEntryDto,
} from '@shipfox/api-agent-dto';

export interface ModelProviderUsageTarget {
  id: string;
  label: string;
  isCustom: boolean;
  models: Array<{id: string; label: string}>;
  default_model: string | null;
}

export function usageTargetFromCatalogEntry(
  entry: ModelProviderCatalogEntryDto,
): ModelProviderUsageTarget {
  return {
    id: entry.id,
    label: entry.label,
    isCustom: false,
    models: entry.models,
    default_model: entry.default_model,
  };
}

export function usageTargetFromCustomConfig(
  config: CustomModelProviderConfigDto,
): ModelProviderUsageTarget {
  return {
    id: config.provider_id,
    label: config.display_name,
    isCustom: true,
    models: config.models,
    default_model: config.default_model,
  };
}
