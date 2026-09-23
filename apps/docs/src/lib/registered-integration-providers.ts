import {
  type CatalogCapability,
  type CatalogCategory,
  INTEGRATION_CATALOG_CATEGORIES,
} from '@/lib/integration-catalog';

interface RegisteredCatalogIntegrationProvider {
  slug: string;
  kind: 'catalog';
  connectable: boolean;
  capabilities: readonly CatalogCapability[];
  category: CatalogCategory;
  displayPriority: number;
}

interface RegisteredBuiltInSource {
  slug: string;
  kind: 'built-in-source';
  events: readonly string[];
  docRoute: string;
}

export type RegisteredIntegrationProvider =
  | RegisteredCatalogIntegrationProvider
  | RegisteredBuiltInSource;

export const registeredIntegrationProviders: readonly RegisteredIntegrationProvider[] = [
  {
    slug: 'github',
    kind: 'catalog',
    connectable: true,
    capabilities: ['source_control', 'events', 'agent_tools'],
    category: 'source-control',
    displayPriority: 1,
  },
  {
    slug: 'linear',
    kind: 'catalog',
    connectable: true,
    capabilities: ['events', 'agent_tools'],
    category: 'issue-tracking',
    displayPriority: 1,
  },
  {
    slug: 'jira',
    kind: 'catalog',
    connectable: true,
    capabilities: ['events', 'agent_tools'],
    category: 'issue-tracking',
    displayPriority: 2,
  },
  {
    slug: 'clickup',
    kind: 'catalog',
    connectable: true,
    capabilities: ['events', 'agent_tools'],
    category: 'issue-tracking',
    displayPriority: 3,
  },
  {
    slug: 'sentry',
    kind: 'catalog',
    connectable: true,
    capabilities: ['events'],
    category: 'observability',
    displayPriority: 1,
  },
  {
    slug: 'posthog',
    kind: 'catalog',
    connectable: true,
    capabilities: ['agent_tools'],
    category: 'observability',
    displayPriority: 2,
  },
  {
    slug: 'slack',
    kind: 'catalog',
    connectable: true,
    capabilities: ['events', 'agent_tools'],
    category: 'messaging',
    displayPriority: 1,
  },
  {
    slug: 'webhooks',
    kind: 'catalog',
    connectable: true,
    capabilities: ['events'],
    category: 'custom',
    displayPriority: 1,
  },
  {
    slug: 'shipfox',
    kind: 'catalog',
    connectable: false,
    capabilities: ['agent_tools'],
    category: 'built-in',
    displayPriority: 1,
  },
  {
    slug: 'cron',
    kind: 'built-in-source',
    events: ['tick'],
    docRoute: '/how-to/author-workflows/schedule-workflows',
  },
];

interface IntegrationProviderDisplayItem {
  slug: string;
  name: string;
}

const catalogProviderBySlug = new Map(
  registeredIntegrationProviders.flatMap((provider) =>
    provider.kind === 'catalog' ? [[provider.slug, provider] as const] : [],
  ),
);

const categoryOrder = new Map(
  INTEGRATION_CATALOG_CATEGORIES.map((category, index) => [category, index]),
);

export function isRegisteredCatalogIntegrationProvider(slug: string): boolean {
  return catalogProviderBySlug.has(slug);
}

export function sortRegisteredIntegrationProviders<Item extends IntegrationProviderDisplayItem>(
  providers: readonly Item[],
): Item[] {
  return providers.toSorted((left, right) => {
    const leftRegistration = catalogProviderBySlug.get(left.slug);
    const rightRegistration = catalogProviderBySlug.get(right.slug);

    if (!leftRegistration && !rightRegistration) return left.name.localeCompare(right.name);
    if (!leftRegistration) return 1;
    if (!rightRegistration) return -1;

    const categoryComparison =
      (categoryOrder.get(leftRegistration.category) ?? Number.MAX_SAFE_INTEGER) -
      (categoryOrder.get(rightRegistration.category) ?? Number.MAX_SAFE_INTEGER);
    if (categoryComparison !== 0) return categoryComparison;

    const priorityComparison = leftRegistration.displayPriority - rightRegistration.displayPriority;
    if (priorityComparison !== 0) return priorityComparison;

    return left.name.localeCompare(right.name);
  });
}
