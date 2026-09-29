import {logger} from '@shipfox/node-opentelemetry';
import {
  REGISTRY_CATALOG_PATH,
  type RegistryCatalog,
  type RegistryPackageIndex,
  registryCatalogSchema,
  registryPackageIndexSchema,
  registryPackagePath,
} from '@shipfox/registry-format';
import {
  deleteRegistryIndex,
  getRegistryIndex,
  touchRegistryIndex,
  upsertRegistryIndex,
} from '#db/indexes.js';
import {
  type RegistryFetchResult,
  type RegistryMetricKind,
  registryCacheHit,
  registryFetch,
} from '#metrics/instance.js';
import {RegistryDisabledError, RegistryUnavailableError} from './errors.js';
import {fetchRegistryIndex, type RegistryIndexFetch} from './registry-files.js';
import type {RegistryIndex} from './registry-index.js';
import type {RegistrySettings} from './settings.js';

const CATALOG_KEY = 'catalog';

// Reads that find a stale copy share one refresh per index instead of each starting their own.
const refreshes = new Map<string, Promise<void>>();

/** The catalog of the configured registry, from the last good copy when the registry is down. */
export async function getCatalog(params: {settings: RegistrySettings}): Promise<RegistryCatalog> {
  const catalog = await readIndex({
    settings: params.settings,
    key: CATALOG_KEY,
    path: REGISTRY_CATALOG_PATH,
    kind: 'catalog',
    schema: registryCatalogSchema,
    fetchIndex: fetchCatalogPages,
  });
  if (!catalog) throw new RegistryUnavailableError('The registry has no catalog');
  return catalog;
}

/** The index of one package, or `undefined` when the registry does not know it. */
export async function getPackageIndex(params: {
  settings: RegistrySettings;
  package: string;
}): Promise<RegistryPackageIndex | undefined> {
  return await readIndex({
    settings: params.settings,
    key: params.package,
    path: registryPackagePath(params.package),
    kind: 'package-index',
    // An index that names another package must not be served in its place.
    schema: registryPackageIndexSchema.refine((index) => index.package === params.package),
  });
}

interface IndexSchema<T> {
  safeParse(value: unknown): {success: true; data: T} | {success: false};
}

interface IndexRead<T> {
  settings: RegistrySettings;
  key: string;
  path: string;
  kind: RegistryMetricKind;
  schema: IndexSchema<T>;
  /** Replaces the single request when an index spans several responses. */
  fetchIndex?: (params: {
    registry: string;
    etag: string | null | undefined;
  }) => Promise<RegistryIndexFetch>;
}

/** The stored row and its parsed body. */
interface StoredIndex<T> {
  row: RegistryIndex;
  value: T;
}

async function readIndex<T>(params: IndexRead<T>): Promise<T | undefined> {
  const {settings, key, kind, schema} = params;
  if (settings.registry === '') throw new RegistryDisabledError();

  const cached = await getRegistryIndex({registry: settings.registry, key});
  const parsed = cached ? schema.safeParse(cached.body) : undefined;
  if (cached && parsed?.success) {
    const stored = {row: cached, value: parsed.data};
    registryCacheHit.add(1, {kind});
    if (isStale({cached, settings})) refreshInBackground({...params, stored});
    return stored.value;
  }
  // A stored body that no longer parses is worth less than none.
  if (cached) await deleteRegistryIndex({registry: settings.registry, key});
  return await refreshIndex({...params, stored: undefined});
}

function isStale(params: {cached: RegistryIndex; settings: RegistrySettings}): boolean {
  const ageMs = Date.now() - params.cached.fetchedAt.getTime();
  return ageMs >= params.settings.catalogRefreshSeconds * 1000;
}

function refreshInBackground<T>(params: IndexRead<T> & {stored: StoredIndex<T>}): void {
  const id = `${params.settings.registry}\n${params.key}`;
  if (refreshes.has(id)) return;
  const refresh = refreshIndex(params)
    .then(() => undefined)
    .catch((error: unknown) => {
      // The last good copy keeps serving, and the next read tries again.
      logger().warn({err: error, key: params.key}, 'Registry index refresh failed');
    })
    .finally(() => refreshes.delete(id));
  refreshes.set(id, refresh);
}

/** Fetches an index, with `If-None-Match` when a copy is stored, and stores what the registry answers. */
async function refreshIndex<T>(
  params: IndexRead<T> & {stored: StoredIndex<T> | undefined},
): Promise<T | undefined> {
  const {settings, key, path, kind, schema, stored} = params;
  const registry = settings.registry;
  const etag = stored?.row.etag;
  try {
    const fetched = params.fetchIndex
      ? await params.fetchIndex({registry, etag})
      : await fetchRegistryIndex({registry, path, etag});
    if (fetched.status === 'not-found') {
      registryFetch.add(1, {kind, result: 'not-found'});
      if (stored) await deleteRegistryIndex({registry, key});
      return undefined;
    }
    if (fetched.status === 'not-modified') {
      if (!stored) {
        throw new RegistryUnavailableError(
          `The registry answered 304 for ${path} without a stored copy`,
        );
      }
      registryFetch.add(1, {kind, result: 'not-modified'});
      await touchRegistryIndex({registry, key, fetchedAt: new Date()});
      return stored.value;
    }
    const parsed = schema.safeParse(parseJson(fetched.body));
    if (!parsed.success) {
      throw new RegistryUnavailableError(`The registry answered a malformed body for ${path}`);
    }
    await upsertRegistryIndex({
      registry,
      key,
      body: parsed.data,
      etag: fetched.etag,
      fetchedAt: new Date(),
    });
    registryFetch.add(1, {kind, result: 'ok'});
    return parsed.data;
  } catch (error) {
    const result = fetchResult(error);
    if (result) registryFetch.add(1, {kind, result});
    throw error;
  }
}

/**
 * Follows `next_cursor` and answers one catalog holding every page. Only the first page carries the
 * stored etag: a change to any entry moves it to the front of the order, so a current first page
 * means the rest is current too.
 */
async function fetchCatalogPages(params: {
  registry: string;
  etag: string | null | undefined;
}): Promise<RegistryIndexFetch> {
  const {registry} = params;
  const first = await fetchRegistryIndex({
    registry,
    path: REGISTRY_CATALOG_PATH,
    etag: params.etag,
  });
  if (first.status !== 'ok') return first;

  let page = parseCatalogPage({body: first.body, path: REGISTRY_CATALOG_PATH});
  const packages = new Map(page.packages.map((entry) => [entry.package, entry]));
  const seen = new Set<string>();
  while (page.next_cursor !== undefined) {
    // A cursor that comes back would page forever.
    if (seen.has(page.next_cursor)) {
      throw new RegistryUnavailableError('The registry catalog cursors loop');
    }
    seen.add(page.next_cursor);
    const path = `${REGISTRY_CATALOG_PATH}?cursor=${encodeURIComponent(page.next_cursor)}`;
    const next = await fetchRegistryIndex({registry, path});
    if (next.status !== 'ok') {
      throw new RegistryUnavailableError(`The registry answered ${next.status} for ${path}`);
    }
    page = parseCatalogPage({body: next.body, path});
    // Offset cursors can repeat an entry when the catalog changes between two requests.
    for (const entry of page.packages) packages.set(entry.package, entry);
  }
  const catalog: RegistryCatalog = {packages: [...packages.values()]};
  return {status: 'ok', body: new TextEncoder().encode(JSON.stringify(catalog)), etag: first.etag};
}

function parseCatalogPage(params: {body: Uint8Array; path: string}): RegistryCatalog {
  const parsed = registryCatalogSchema.safeParse(parseJson(params.body));
  if (!parsed.success) {
    throw new RegistryUnavailableError(`The registry answered a malformed body for ${params.path}`);
  }
  return parsed.data;
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function fetchResult(error: unknown): RegistryFetchResult | undefined {
  return error instanceof RegistryUnavailableError ? 'unavailable' : undefined;
}
