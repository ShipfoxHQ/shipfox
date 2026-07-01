import type {AgentProviderCatalogEntryDto, SupportedAgentProviderId} from '@shipfox/api-agent-dto';

export type SupportedAgentProviderCatalogEntry = AgentProviderCatalogEntryDto & {
  id: SupportedAgentProviderId;
  support_status: 'supported';
};

export function isSupportedCatalogEntry(
  entry: AgentProviderCatalogEntryDto | undefined,
): entry is SupportedAgentProviderCatalogEntry {
  return entry?.support_status === 'supported';
}

export function toSupportedCatalogEntry(
  entry: AgentProviderCatalogEntryDto | undefined,
): SupportedAgentProviderCatalogEntry | undefined {
  if (!isSupportedCatalogEntry(entry)) return undefined;
  return entry;
}
