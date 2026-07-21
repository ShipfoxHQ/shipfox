import {normalizeCatalogQuery} from '@/lib/docs-analytics-core';
import {
  type CatalogFilters,
  type CatalogProvider,
  filterProviders,
} from '@/lib/integration-catalog';

export function catalogAnalyticsContext(filters: CatalogFilters) {
  const query = normalizeCatalogQuery(filters.query);
  return {
    query: query.query,
    query_length: query.queryLength,
    query_redacted: query.queryRedacted,
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
  providers: readonly CatalogProvider[],
  filters: CatalogFilters,
  change: {
    facet: 'capability' | 'category' | 'all';
    value: string;
    action: 'selected' | 'removed' | 'cleared';
  },
) {
  return {
    ...catalogAnalyticsContext(filters),
    ...change,
    result_count: filterProviders(providers, filters).length,
  };
}

export function catalogResultClickedProperties(
  filters: CatalogFilters,
  filteredProviders: readonly CatalogProvider[],
  provider: CatalogProvider,
  target: 'overview' | 'setup',
) {
  return {
    ...catalogAnalyticsContext(filters),
    provider: provider.slug,
    target,
    result_rank: filteredProviders.findIndex((candidate) => candidate.slug === provider.slug) + 1,
    result_count: filteredProviders.length,
  };
}
