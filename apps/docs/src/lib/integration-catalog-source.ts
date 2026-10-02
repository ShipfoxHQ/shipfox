import 'server-only';

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  type CatalogCapability,
  type CatalogEntry,
  type CatalogProvider,
  INTEGRATION_CATALOG_CATEGORIES,
  type RequestableIntegration,
} from '@/lib/integration-catalog';
import {validateIntegrationCatalog} from '@/lib/integration-catalog-validation';
import {
  registeredIntegrationProviders,
  sortRegisteredIntegrationProviders,
} from '@/lib/registered-integration-providers';
import {requestableIntegrations} from '@/lib/requestable-integrations';
import {source} from '@/lib/source';

export {validateIntegrationCatalog} from '@/lib/integration-catalog-validation';

interface GeneratedCatalogData {
  capabilities: CatalogCapability[];
  eventCount: number;
  toolCount: number;
}

export function getIntegrationCatalog(): CatalogProvider[] {
  const generatedCatalogData = getGeneratedCatalogData();
  const providers: CatalogProvider[] = source
    .getPages()
    .filter((page) => page.slugs[0] === 'integrations' && page.slugs.length === 2)
    .map((page): CatalogProvider => {
      const catalog = page.data.catalog;
      const slug = page.slugs[1];
      if (!catalog)
        throw new Error(`Integration catalog metadata is missing for provider "${slug}".`);

      const generatedData = generatedCatalogData[slug];
      const setupPage = source.getPage([...page.slugs, 'setup']);

      return {
        slug,
        name: catalog.name,
        summary: catalog.summary,
        capabilities: catalog.capabilities,
        categories: catalog.categories,
        aliases: catalog.aliases,
        icon: catalog.icon,
        overviewHref: page.url,
        setupHref: setupPage?.url,
        eventCount: generatedData?.eventCount ?? 0,
        toolCount: generatedData?.toolCount ?? 0,
      };
    });

  validateIntegrationCatalog(
    providers,
    Object.fromEntries(
      registeredIntegrationProviders.flatMap((provider) =>
        provider.kind === 'catalog'
          ? [
              [
                provider.slug,
                {capabilities: provider.capabilities, connectable: provider.connectable},
              ],
            ]
          : [],
      ),
    ),
  );

  return sortRegisteredIntegrationProviders(providers);
}

// Self-serve providers come first in their registered order, then the
// integrations a workspace can ask for, grouped by category.
export function getIntegrationCatalogEntries(): CatalogEntry[] {
  const providers = getIntegrationCatalog();
  return [
    ...providers.map((provider) => ({...provider, availability: 'self_serve' as const})),
    ...getRequestableIntegrations(providers).map((integration) => ({
      ...integration,
      availability: 'on_request' as const,
    })),
  ];
}

export function getRequestableIntegrations(
  providers: readonly CatalogProvider[] = getIntegrationCatalog(),
): RequestableIntegration[] {
  const providerSlugs = new Set(providers.map((provider) => provider.slug));
  for (const integration of requestableIntegrations) {
    if (providerSlugs.has(integration.slug))
      throw new Error(
        `Integration "${integration.slug}" has docs pages, so remove it from the on-request list.`,
      );
  }

  return requestableIntegrations.toSorted(
    (left, right) =>
      INTEGRATION_CATALOG_CATEGORIES.indexOf(left.categories[0]) -
        INTEGRATION_CATALOG_CATEGORIES.indexOf(right.categories[0]) ||
      left.name.localeCompare(right.name),
  );
}

function getGeneratedCatalogData(): Record<string, GeneratedCatalogData> {
  const path = join(process.cwd(), 'content/generated/integrations/catalog.json');
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, GeneratedCatalogData>;
}
