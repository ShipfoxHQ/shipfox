import type {CatalogAvailability, CatalogCapability} from '@/lib/integration-catalog';

interface RegisteredCatalogIntegrationProvider {
  slug: string;
  kind: 'catalog';
  availability: CatalogAvailability;
  capabilities: readonly CatalogCapability[];
}

interface RegisteredBuiltInSource {
  slug: string;
  kind: 'built-in-source';
  availability: 'available';
  events: readonly string[];
  docRoute: '/reference/trigger-sources';
  anchor: string;
}

export type RegisteredIntegrationProvider =
  | RegisteredCatalogIntegrationProvider
  | RegisteredBuiltInSource;

export const registeredIntegrationProviders: readonly RegisteredIntegrationProvider[] = [
  {
    slug: 'github',
    kind: 'catalog',
    availability: 'available',
    capabilities: ['source_control', 'events', 'agent_tools'],
  },
  {
    slug: 'sentry',
    kind: 'catalog',
    availability: 'available',
    capabilities: ['events'],
  },
  {
    slug: 'webhooks',
    kind: 'catalog',
    availability: 'available',
    capabilities: ['events'],
  },
  {slug: 'linear', kind: 'catalog', availability: 'coming-soon', capabilities: []},
  {slug: 'slack', kind: 'catalog', availability: 'coming-soon', capabilities: []},
  {
    slug: 'cron',
    kind: 'built-in-source',
    availability: 'available',
    events: ['tick'],
    docRoute: '/reference/trigger-sources',
    anchor: 'cron',
  },
];
