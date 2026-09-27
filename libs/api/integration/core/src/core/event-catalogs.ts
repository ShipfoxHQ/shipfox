import type {IntegrationProviderRegistry} from '#core/providers/registry.js';

/**
 * Providers whose event names are minted by Shipfox. An explicit event on one of
 * these providers is provably wrong unless its catalog lists it; every other
 * provider's event names are provider-minted and never treated as a closed set. `manual` and `cron` are registered built-in trigger sources;
 * sync classifies them by literal, before slug resolution.
 */
export const FIXED_EVENT_PROVIDERS = ['webhook', 'shipfox'] as const;

export interface ProviderEventCatalog {
  provider: string;
  events: string[];
}

/** Keeps fixed-provider metadata aligned with the enabled provider registry. */
export function buildFixedEventProviders(
  registry: IntegrationProviderRegistry,
): Array<(typeof FIXED_EVENT_PROVIDERS)[number]> {
  const registeredProviders = new Set(registry.list().map(({provider}) => provider));
  return FIXED_EVENT_PROVIDERS.filter((provider) => registeredProviders.has(provider));
}

/** Collects the event names each registered provider documents. */
export function buildProviderEventCatalogs(
  registry: IntegrationProviderRegistry,
): ProviderEventCatalog[] {
  return registry.list().flatMap((provider) => {
    const catalog = provider.eventCatalog;
    if (catalog === undefined) return [];
    return [{provider: provider.provider, events: catalog.events.map((event) => event.name)}];
  });
}
