import type {CatalogCapability, CatalogProvider} from '@/lib/integration-catalog';

interface CatalogProviderExpectation {
  capabilities: readonly CatalogCapability[];
  connectable: boolean;
}

function validateProvider(provider: CatalogProvider, expected: CatalogProviderExpectation): void {
  const prefix = `Integration catalog provider "${provider.slug}"`;
  for (const capability of expected.capabilities) {
    if (!provider.capabilities.includes(capability)) {
      throw new Error(`${prefix} has a ${capability} DTO catalog but omits that capability.`);
    }
  }
  if (provider.capabilities.includes('events') && provider.eventCount === 0) {
    throw new Error(`${prefix} declares events but its event count is 0.`);
  }
  if (provider.capabilities.includes('agent_tools') && provider.toolCount === 0) {
    throw new Error(`${prefix} declares agent tools but its tool count is 0.`);
  }
  if (expected.connectable && !provider.setupHref) throw new Error(`${prefix} has no setup page.`);
  if (!expected.connectable && provider.setupHref)
    throw new Error(`${prefix} has a setup page but needs no setup.`);
}

export function validateIntegrationCatalog(
  providers: readonly CatalogProvider[],
  expectedBySlug: Record<string, CatalogProviderExpectation> = {},
): void {
  const providerSlugs = new Set(providers.map((provider) => provider.slug));
  for (const slug of Object.keys(expectedBySlug)) {
    if (!providerSlugs.has(slug))
      throw new Error(`Generated DTO catalog for "${slug}" has no matching provider page.`);
  }

  for (const provider of providers) {
    const expected = expectedBySlug[provider.slug] ?? {capabilities: [], connectable: true};
    validateProvider(provider, expected);
  }
}
