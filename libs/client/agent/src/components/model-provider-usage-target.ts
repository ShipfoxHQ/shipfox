import type {CustomProviderConfig, SupportedProvider} from '#core/models.js';

export interface ModelProviderUsageTarget {
  id: string;
  label: string;
  isCustom: boolean;
  models: ReadonlyArray<{id: string; label: string}>;
  defaultModel: string | null;
}

export function usageTargetFromCatalogEntry(entry: SupportedProvider): ModelProviderUsageTarget {
  const provider = entry;
  return {
    id: provider.id,
    label: provider.label,
    isCustom: false,
    models: provider.models,
    defaultModel: provider.defaultModel,
  };
}

export function usageTargetFromCustomConfig(
  config: CustomProviderConfig,
): ModelProviderUsageTarget {
  const provider = config;
  return {
    id: provider.providerId,
    label: provider.displayName,
    isCustom: true,
    models: provider.models,
    defaultModel: provider.defaultModel,
  };
}
