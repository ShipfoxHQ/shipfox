import {getModels, type KnownProvider} from '@earendil-works/pi-ai';
import {
  AGENT_PROVIDER_CATALOG_SEED,
  type AgentProviderCatalogEntryDto,
  agentProviderCatalogEntrySchema,
} from '@shipfox/api-agent-dto';

let cachedCatalog: readonly AgentProviderCatalogEntryDto[] | undefined;

export function buildAgentProviderCatalog(): readonly AgentProviderCatalogEntryDto[] {
  if (cachedCatalog) return cachedCatalog;

  const catalog = agentProviderCatalogEntrySchema.array().parse(
    AGENT_PROVIDER_CATALOG_SEED.map((entry) => ({
      ...entry,
      credential_fields: entry.credential_fields.map((field) => ({...field})),
      models:
        entry.support_status === 'supported'
          ? getModels(entry.id as KnownProvider).map((model) => ({
              id: model.id,
              label: model.name,
            }))
          : [],
    })),
  );

  cachedCatalog = deepFreeze(catalog);
  return cachedCatalog;
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
  }

  return Object.freeze(value);
}
