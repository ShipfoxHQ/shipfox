import {
  MODEL_PROVIDER_CATALOG_SEED,
  type ModelProviderCatalogEntryDto,
  modelProviderCatalogEntrySchema,
} from '@shipfox/api-agent-dto';
import {listPiProviderModels} from './harness/pi.js';

let cachedCatalog: readonly ModelProviderCatalogEntryDto[] | undefined;

export function buildModelProviderCatalog(): readonly ModelProviderCatalogEntryDto[] {
  if (cachedCatalog) return cachedCatalog;

  const catalog = modelProviderCatalogEntrySchema.array().parse(
    MODEL_PROVIDER_CATALOG_SEED.map((entry) => ({
      ...entry,
      credential_fields: entry.credential_fields.map((field) => ({...field})),
      models: entry.support_status === 'supported' ? listPiProviderModels(entry.id) : [],
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
