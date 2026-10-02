export const INTEGRATION_CATALOG_CAPABILITIES = [
  'source_control',
  'events',
  'agent_tools',
] as const;
export const INTEGRATION_CATALOG_CATEGORIES = [
  'built-in',
  'source-control',
  'ci-cd',
  'issue-tracking',
  'docs-knowledge',
  'observability',
  'product-analytics',
  'incident-management',
  'messaging',
  'security',
  'cloud',
  'data',
  'support',
  'design',
  'mobile-release',
  'business',
] as const;
export const INTEGRATION_CATALOG_AVAILABILITIES = ['self_serve', 'on_request'] as const;
export const INTEGRATION_CATALOG_ICONS = [
  'github',
  'sentry',
  'webhooks',
  'linear',
  'slack',
  'jira',
  'clickup',
  'notion',
  'posthog',
  'shipfox',
] as const;

export type CatalogCapability = (typeof INTEGRATION_CATALOG_CAPABILITIES)[number];
export type CatalogCategory = (typeof INTEGRATION_CATALOG_CATEGORIES)[number];
export type CatalogIcon = (typeof INTEGRATION_CATALOG_ICONS)[number];
export type CatalogAvailability = (typeof INTEGRATION_CATALOG_AVAILABILITIES)[number];

export const catalogCapabilityLabels: Record<CatalogCapability, string> = {
  source_control: 'Code checkout',
  events: 'Events',
  agent_tools: 'Tools',
};

export const catalogCategoryLabels: Record<CatalogCategory, string> = {
  'built-in': 'Built-in',
  'source-control': 'Source control',
  'ci-cd': 'CI/CD and deploys',
  'issue-tracking': 'Issue tracking',
  'docs-knowledge': 'Docs and knowledge',
  observability: 'Observability',
  'product-analytics': 'Product analytics and flags',
  'incident-management': 'Incidents and on-call',
  messaging: 'Messaging and email',
  security: 'Security and compliance',
  cloud: 'Cloud and infrastructure',
  data: 'Data and databases',
  support: 'Support and CRM',
  design: 'Design and feedback',
  'mobile-release': 'Mobile releases',
  business: 'Business tools',
};

export const catalogAvailabilityLabels: Record<CatalogAvailability, string> = {
  self_serve: 'Self-serve',
  on_request: 'On request',
};

// Tally fills the `integration` hidden field from the query string and posts
// each submission to Slack, so a request needs no backend of its own.
const INTEGRATION_REQUEST_FORM_URL = 'https://forms.shipfox.io/integration-request';

export function integrationRequestHref(integrationName?: string): string {
  if (!integrationName) return INTEGRATION_REQUEST_FORM_URL;
  return `${INTEGRATION_REQUEST_FORM_URL}?${new URLSearchParams({integration: integrationName})}`;
}

export interface CatalogProvider {
  slug: string;
  name: string;
  summary: string;
  capabilities: CatalogCapability[];
  categories: CatalogCategory[];
  aliases: string[];
  icon: CatalogIcon;
  overviewHref: string;
  setupHref?: string;
  eventCount: number;
  toolCount: number;
}

// An integration Shipfox does not ship yet. It has no events, tools, or setup
// page, only a way to ask for it.
export interface RequestableIntegration {
  slug: string;
  name: string;
  summary: string;
  categories: CatalogCategory[];
  aliases: string[];
  // A single path in a 24x24 view box, drawn in the current text colour.
  iconPath: string;
}

export type CatalogEntry =
  | ({availability: 'self_serve'} & CatalogProvider)
  | ({availability: 'on_request'} & RequestableIntegration);

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

export function filterCatalogEntries(
  entries: readonly CatalogEntry[],
  filters: CatalogFilters,
): CatalogEntry[] {
  const query = filters.query.trim().toLocaleLowerCase();

  return entries.filter((entry) => {
    return (
      matchesQuery(entry, query) &&
      matchesAvailability(entry, filters.availability) &&
      matchesCapabilities(entry, filters.capability) &&
      matchesCategories(entry, filters.category)
    );
  });
}

export function countFacetValues(
  entries: readonly CatalogEntry[],
  filters: CatalogFilters,
): {
  availability: Record<CatalogAvailability, number>;
  capability: Record<CatalogCapability, number>;
  category: Record<CatalogCategory, number>;
} {
  const query = filters.query.trim().toLocaleLowerCase();

  return {
    availability: countValues(INTEGRATION_CATALOG_AVAILABILITIES, (availability) =>
      entries.filter(
        (entry) =>
          matchesQuery(entry, query) &&
          matchesCapabilities(entry, filters.capability) &&
          matchesCategories(entry, filters.category) &&
          entry.availability === availability,
      ),
    ),
    capability: countValues(INTEGRATION_CATALOG_CAPABILITIES, (capability) =>
      entries.filter(
        (entry) =>
          matchesQuery(entry, query) &&
          matchesAvailability(entry, filters.availability) &&
          matchesCategories(entry, filters.category) &&
          entryCapabilities(entry).includes(capability),
      ),
    ),
    category: countValues(INTEGRATION_CATALOG_CATEGORIES, (category) =>
      entries.filter(
        (entry) =>
          matchesQuery(entry, query) &&
          matchesAvailability(entry, filters.availability) &&
          matchesCapabilities(entry, filters.capability) &&
          entry.categories.includes(category),
      ),
    ),
  };
}

function entryCapabilities(entry: CatalogEntry): readonly CatalogCapability[] {
  return entry.availability === 'self_serve' ? entry.capabilities : [];
}

function countValues<Value extends string>(
  values: readonly Value[],
  matches: (value: Value) => readonly CatalogEntry[],
): Record<Value, number> {
  const counts = {} as Record<Value, number>;

  for (const value of values) {
    counts[value] = matches(value).length;
  }

  return counts;
}

function matchesQuery(entry: CatalogEntry, query: string): boolean {
  if (query.length === 0) return true;

  const searchableText = [
    entry.name,
    entry.summary,
    ...entry.categories.map((category) => catalogCategoryLabels[category]),
    ...entry.aliases,
  ]
    .join(' ')
    .toLocaleLowerCase();

  return searchableText.includes(query);
}

function matchesAvailability(
  entry: CatalogEntry,
  availabilities: readonly CatalogAvailability[],
): boolean {
  return availabilities.length === 0 || availabilities.includes(entry.availability);
}

function matchesCapabilities(
  entry: CatalogEntry,
  capabilities: readonly CatalogCapability[],
): boolean {
  return (
    capabilities.length === 0 ||
    capabilities.some((capability) => entryCapabilities(entry).includes(capability))
  );
}

function matchesCategories(entry: CatalogEntry, categories: readonly CatalogCategory[]): boolean {
  return (
    categories.length === 0 || categories.some((category) => entry.categories.includes(category))
  );
}
