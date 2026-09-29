import {
  type ManagedModelLock,
  type ManagedModelProvider,
  MODEL_PROVIDER_CATALOG_SEED,
  type ModelProviderCatalogEntryDto,
  modelProviderCatalogEntrySchema,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {config} from '#config.js';
import {listPiProviderModels} from './harness/pi.js';

let cachedCatalog: readonly ModelProviderCatalogEntryDto[] | undefined;

export interface ModelProviderCatalogResponse {
  readonly providers: readonly ModelProviderCatalogEntryDto[];
  readonly workspaceProviders: WorkspaceProvidersPolicy;
  readonly managedProviderId: string | null;
  readonly instanceDefaultProviderId: string | null;
}

export function buildModelProviderCatalogResponse(
  options: {
    managedProvider?: ManagedModelProvider | undefined;
    workspaceProviders?: WorkspaceProvidersPolicy | undefined;
    lockedModels?: ReadonlyMap<string, ManagedModelLock> | undefined;
  } = {},
): ModelProviderCatalogResponse {
  const workspaceProviders = options.workspaceProviders ?? 'enabled';
  return {
    providers: buildModelProviderCatalog({
      managedProvider: options.managedProvider,
      workspaceProviders,
      lockedModels: options.lockedModels,
    }),
    workspaceProviders,
    managedProviderId: options.managedProvider?.id ?? null,
    instanceDefaultProviderId: config.AGENT_DEFAULT_PROVIDER || null,
  };
}

export function buildModelProviderCatalog(
  options: {
    managedProvider?: ManagedModelProvider | undefined;
    workspaceProviders?: WorkspaceProvidersPolicy | undefined;
    lockedModels?: ReadonlyMap<string, ManagedModelLock> | undefined;
  } = {},
): readonly ModelProviderCatalogEntryDto[] {
  const workspaceProviders = options.workspaceProviders ?? 'enabled';
  if (workspaceProviders === 'disabled') {
    if (options.managedProvider === undefined) {
      throw new Error(
        'workspace provider configuration is disabled but no managed provider is registered',
      );
    }
    return Object.freeze([
      toManagedProviderCatalogEntry(options.managedProvider, options.lockedModels),
    ]);
  }

  const catalog = getCatalog();
  if (options.managedProvider === undefined) return catalog;

  return Object.freeze([
    ...catalog,
    toManagedProviderCatalogEntry(options.managedProvider, options.lockedModels),
  ]);
}

function getCatalog(): readonly ModelProviderCatalogEntryDto[] {
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

function toManagedProviderCatalogEntry(
  managedProvider: ManagedModelProvider,
  lockedModels: ReadonlyMap<string, ManagedModelLock> = new Map(),
): ModelProviderCatalogEntryDto {
  return deepFreeze(
    modelProviderCatalogEntrySchema.parse({
      id: managedProvider.id,
      label: managedProvider.label,
      support_status: 'supported',
      default_model: managedProvider.defaultModel,
      credential_fields: [],
      unsupported_reason: null,
      models: managedProvider.models.map(({id, label, api, price, references}) => {
        const lock = lockedModels.get(id);
        return {
          id,
          label,
          api,
          ...(price === undefined ? {} : {price}),
          ...(references === undefined ? {} : {references}),
          ...(lock === undefined ? {} : {locked: {label: lock.label, notice: lock.notice}}),
        };
      }),
    }),
  );
}

function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) deepFreeze(item);
  }

  return Object.freeze(value);
}
