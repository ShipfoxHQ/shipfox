import type {ModelProviderCatalogEntryDto} from '@shipfox/api-agent-dto';

export function providerMatchesSearch(entry: ModelProviderCatalogEntryDto, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;

  const haystack = `${entry.label} ${entry.id} ${entry.models
    .map((model) => `${model.id} ${model.label}`)
    .join(' ')}`.toLowerCase();
  return haystack.includes(needle);
}
