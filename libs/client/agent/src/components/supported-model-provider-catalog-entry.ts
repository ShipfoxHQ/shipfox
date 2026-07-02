import type {ModelProviderCatalogEntryDto, SupportedModelProviderId} from '@shipfox/api-agent-dto';

export type SupportedModelProviderCatalogEntry = ModelProviderCatalogEntryDto & {
  id: SupportedModelProviderId;
  support_status: 'supported';
};

export function isSupportedCatalogEntry(
  entry: ModelProviderCatalogEntryDto | undefined,
): entry is SupportedModelProviderCatalogEntry {
  return entry?.support_status === 'supported';
}

export function toSupportedCatalogEntry(
  entry: ModelProviderCatalogEntryDto | undefined,
): SupportedModelProviderCatalogEntry | undefined {
  if (!isSupportedCatalogEntry(entry)) return undefined;
  return entry;
}
