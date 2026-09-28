import {
  canonicalJson,
  compareRegistryVersions,
  parseRegistryPackageName,
  type RegistryCatalog,
  type RegistryCatalogEntry,
  type RegistryPackageIndex,
  type RegistryVersionDocument,
} from '@shipfox/registry-format';
import type {ZodType} from 'zod';
import type {RegistryBootstrap} from '#bootstrap.js';
import {
  type RegistryStorage,
  StoragePreconditionFailedError,
  type StoredObject,
} from '#storage/storage.js';

export const JSON_CONTENT_TYPE = 'application/json';
const UPDATE_ATTEMPTS = 5;

/**
 * Read-modify-write of a mutable JSON file, guarded by its etag so concurrent writers never lose
 * each other's changes. `update` receives `undefined` when the file does not exist yet.
 */
export function updateJsonFile<T>({
  storage,
  key,
  schema,
  update,
}: {
  storage: RegistryStorage;
  key: string;
  schema: ZodType<T>;
  update: (current: T | undefined) => T;
}): Promise<T> {
  return putWithRetry({
    storage,
    key,
    next: (stored) => {
      const current = stored ? schema.parse(JSON.parse(stored.body.toString('utf8'))) : undefined;
      return schema.parse(update(current));
    },
  });
}

/** Overwrites a mutable JSON file without reading it, so a corrupted file can be repaired. */
export function replaceJsonFile<T>({
  storage,
  key,
  value,
}: {
  storage: RegistryStorage;
  key: string;
  value: T;
}): Promise<T> {
  return putWithRetry({storage, key, next: () => value});
}

async function putWithRetry<T>({
  storage,
  key,
  next,
}: {
  storage: RegistryStorage;
  key: string;
  next: (stored: StoredObject | null) => T;
}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const stored = await storage.get(key);
    const value = next(stored);
    try {
      await storage.put({
        key,
        body: jsonBody(value),
        contentType: JSON_CONTENT_TYPE,
        ...(stored ? {ifMatch: stored.etag} : {ifNoneMatch: '*'}),
      });
      return value;
    } catch (error) {
      const retry = error instanceof StoragePreconditionFailedError && attempt < UPDATE_ATTEMPTS;
      if (!retry) throw error;
    }
  }
}

export function jsonBody(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

/** `documents` holds every version of one package. */
export function buildPackageIndex(documents: RegistryVersionDocument[]): RegistryPackageIndex {
  const sorted = sortByVersion(documents);
  const latest = sorted.at(-1);
  if (!latest) throw new TypeError('A package index needs at least one version');
  return {
    package: latest.package,
    kind: latest.kind,
    versions: sorted.map((document, index) => ({
      version: document.version,
      digest: document.content.digest,
      published_at: document.published_at,
      ...(document.bump ? {bump: document.bump} : {}),
      capability_change: hasCapabilityChange(sorted[index - 1], document),
    })),
  };
}

export function buildCatalogEntry({
  documents,
  bootstrap,
}: {
  documents: RegistryVersionDocument[];
  bootstrap: RegistryBootstrap;
}): RegistryCatalogEntry {
  const sorted = sortByVersion(documents);
  const latest = sorted.at(-1);
  if (!latest) throw new TypeError('A catalog entry needs at least one version');
  const {manifest, derived} = latest;
  const isAction = latest.kind === 'action';
  return curateEntry({
    bootstrap,
    entry: {
      package: latest.package,
      kind: latest.kind,
      title: stringField(isAction ? manifest.name : manifest.title) ?? latest.package,
      summary: stringField(isAction ? manifest.description : manifest.summary) ?? '',
      keywords: stringArrayField(manifest.keywords),
      integrations: stringArrayField(derived.integrations),
      latest: latest.version,
      published_at: latest.published_at,
      first_published_at: sorted
        .map((document) => document.published_at)
        .reduce((earliest, publishedAt) => (publishedAt < earliest ? publishedAt : earliest)),
      publisher: {namespace: '', display_name: '', verified: false},
    },
  });
}

/** Applies the bootstrap's `featured` order and publisher profiles to every catalog entry. */
export function curateCatalog({
  catalog,
  bootstrap,
}: {
  catalog: RegistryCatalog;
  bootstrap: RegistryBootstrap;
}): RegistryCatalog {
  const packages = catalog.packages.map((entry) => curateEntry({entry, bootstrap}));
  packages.sort(
    (left, right) =>
      (left.featured ?? Number.POSITIVE_INFINITY) - (right.featured ?? Number.POSITIVE_INFINITY) ||
      left.package.localeCompare(right.package),
  );
  return {packages};
}

function curateEntry({
  entry,
  bootstrap,
}: {
  entry: RegistryCatalogEntry;
  bootstrap: RegistryBootstrap;
}): RegistryCatalogEntry {
  const {featured: _featured, ...rest} = entry;
  const namespace = parseRegistryPackageName(entry.package)?.namespace ?? '';
  const profile = bootstrap.namespaces[namespace]?.profile;
  const position = bootstrap.featured.indexOf(entry.package);
  return {
    ...rest,
    ...(position === -1 ? {} : {featured: position + 1}),
    publisher: {
      namespace,
      display_name: profile?.display_name ?? namespace,
      verified: profile?.verified ?? false,
    },
  };
}

function hasCapabilityChange(
  previous: RegistryVersionDocument | undefined,
  document: RegistryVersionDocument,
): boolean {
  if (!previous || document.kind !== 'action') return false;
  return (
    canonicalJson(previous.derived.capabilities ?? {}) !==
    canonicalJson(document.derived.capabilities ?? {})
  );
}

function sortByVersion(documents: RegistryVersionDocument[]): RegistryVersionDocument[] {
  return [...documents].sort((left, right) => compareRegistryVersions(left.version, right.version));
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
