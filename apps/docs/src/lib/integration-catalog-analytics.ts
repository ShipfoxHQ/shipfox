import {normalizeCatalogQuery} from '@/lib/docs-analytics-core';
import {
  type CatalogEntry,
  type CatalogFilters,
  filterCatalogEntries,
} from '@/lib/integration-catalog';

export function catalogAnalyticsContext(filters: CatalogFilters) {
  const query = normalizeCatalogQuery(filters.query);
  return {
    query: query.query,
    query_length: query.queryLength,
    query_redacted: query.queryRedacted,
    selected_availability: filters.availability,
    selected_capabilities: filters.capability,
    selected_categories: filters.category,
  };
}

export function catalogSearchProperties(filters: CatalogFilters, resultCount: number) {
  return {
    ...catalogAnalyticsContext(filters),
    result_count: resultCount,
    has_results: resultCount > 0,
  };
}

export function catalogFilterChangedProperties(
  entries: readonly CatalogEntry[],
  filters: CatalogFilters,
  change: {
    facet: 'availability' | 'capability' | 'category' | 'all';
    value: string;
    action: 'selected' | 'removed' | 'cleared';
  },
) {
  return {
    ...catalogAnalyticsContext(filters),
    ...change,
    result_count: filterCatalogEntries(entries, filters).length,
  };
}

export function catalogResultClickedProperties(
  filters: CatalogFilters,
  filteredEntries: readonly CatalogEntry[],
  entry: CatalogEntry,
  target: 'overview' | 'setup' | 'request',
) {
  return {
    ...catalogAnalyticsContext(filters),
    provider: entry.slug,
    availability: entry.availability,
    target,
    result_rank: filteredEntries.findIndex((candidate) => candidate.slug === entry.slug) + 1,
    result_count: filteredEntries.length,
  };
}
