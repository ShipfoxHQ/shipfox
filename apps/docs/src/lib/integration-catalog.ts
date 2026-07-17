export const INTEGRATION_CATALOG_AVAILABILITIES = ['available', 'preview', 'coming-soon'] as const;
export const INTEGRATION_CATALOG_CAPABILITIES = [
  'source_control',
  'events',
  'agent_tools',
] as const;
export const INTEGRATION_CATALOG_CATEGORIES = [
  'source-control',
  'observability',
  'custom',
  'issue-tracking',
  'messaging',
] as const;
export const INTEGRATION_CATALOG_ICONS = [
  'github',
  'sentry',
  'webhooks',
  'linear',
  'slack',
] as const;

export type CatalogAvailability = (typeof INTEGRATION_CATALOG_AVAILABILITIES)[number];
export type CatalogCapability = (typeof INTEGRATION_CATALOG_CAPABILITIES)[number];
export type CatalogCategory = (typeof INTEGRATION_CATALOG_CATEGORIES)[number];
export type CatalogIcon = (typeof INTEGRATION_CATALOG_ICONS)[number];

export const catalogAvailabilityLabels: Record<CatalogAvailability, string> = {
  available: 'Available',
  preview: 'Preview',
  'coming-soon': 'Coming soon',
};

export const catalogCapabilityLabels: Record<CatalogCapability, string> = {
  source_control: 'Source control',
  events: 'Events',
  agent_tools: 'Agent tools',
};

export const catalogCategoryLabels: Record<CatalogCategory, string> = {
  'source-control': 'Source control',
  observability: 'Observability',
  custom: 'Custom',
  'issue-tracking': 'Issue tracking',
  messaging: 'Messaging',
};

export interface CatalogProvider {
  slug: string;
  name: string;
  summary: string;
  availability: CatalogAvailability;
  capabilities: CatalogCapability[];
  categories: CatalogCategory[];
  aliases: string[];
  icon: CatalogIcon;
  overviewHref: string;
  setupHref?: string;
  eventCount: number;
  toolCount: number;
}

export interface CatalogFilters {
  query: string;
  availability: readonly CatalogAvailability[];
  capability: readonly CatalogCapability[];
  category: readonly CatalogCategory[];
}

export const emptyCatalogFilters: CatalogFilters = {
  query: '',
  availability: [],
  capability: [],
  category: [],
};

export function filterProviders(
  providers: readonly CatalogProvider[],
  filters: CatalogFilters,
): CatalogProvider[] {
  const query = filters.query.trim().toLocaleLowerCase();

  return providers.filter((provider) => {
    const searchableText = [
      provider.name,
      provider.summary,
      ...provider.categories.map((category) => catalogCategoryLabels[category]),
      ...provider.aliases,
    ]
      .join(' ')
      .toLocaleLowerCase();
    const matchesQuery = query.length === 0 || searchableText.includes(query);
    const matchesAvailability =
      filters.availability.length === 0 || filters.availability.includes(provider.availability);
    const matchesCapability =
      filters.capability.length === 0 ||
      filters.capability.some((capability) => provider.capabilities.includes(capability));
    const matchesCategory =
      filters.category.length === 0 ||
      filters.category.some((category) => provider.categories.includes(category));

    return matchesQuery && matchesAvailability && matchesCapability && matchesCategory;
  });
}
