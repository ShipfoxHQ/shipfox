import type {
  RegistryCatalog,
  RegistryCatalogEntry,
  RegistryNamespaceProfile,
  RegistryPackageIndex,
} from '@shipfox/registry-format';
import type {RegistryBootstrap} from '#bootstrap.js';
import type {IndexedVersion, PublicPackage} from '#read/queries.js';

export const CATALOG_PAGE_SIZE = 100;

const OFFSET_PATTERN = /^\d+$/;

export class InvalidCursorError extends Error {
  override name = 'InvalidCursorError';
}

/** The featured packages first, in the operator's order, then the rest by latest publication. */
export function buildCatalog({
  rows,
  bootstrap,
  cursor,
}: {
  rows: PublicPackage[];
  bootstrap: RegistryBootstrap;
  cursor: string | undefined;
}): RegistryCatalog {
  const start = decodeCursor(cursor);
  const entries = rows
    .map((row) => catalogEntry({row, bootstrap}))
    .sort(
      (a, b) =>
        (a.featured ?? Number.POSITIVE_INFINITY) - (b.featured ?? Number.POSITIVE_INFINITY) ||
        b.published_at.localeCompare(a.published_at) ||
        a.package.localeCompare(b.package),
    );
  const end = start + CATALOG_PAGE_SIZE;
  return {
    packages: entries.slice(start, end),
    ...(end < entries.length ? {next_cursor: encodeCursor(end)} : {}),
  };
}

function catalogEntry({
  row,
  bootstrap,
}: {
  row: PublicPackage;
  bootstrap: RegistryBootstrap;
}): RegistryCatalogEntry {
  const position = bootstrap.featured.indexOf(row.name);
  return {
    package: row.name,
    kind: row.kind as RegistryCatalogEntry['kind'],
    title: row.title,
    summary: row.summary,
    keywords: row.keywords,
    integrations: row.integrations,
    latest: row.latestVersion,
    published_at: row.latestPublishedAt.toISOString(),
    first_published_at: row.firstPublishedAt.toISOString(),
    ...(position === -1 ? {} : {featured: position + 1}),
    publisher: publisherOf({namespace: row.namespace, bootstrap}),
  };
}

function publisherOf({
  namespace,
  bootstrap,
}: {
  namespace: string;
  bootstrap: RegistryBootstrap;
}): RegistryCatalogEntry['publisher'] {
  const profile = bootstrap.namespaces[namespace]?.profile;
  // A namespace dropped from the bootstrap file keeps its versions, and nobody vouches for it.
  return {
    namespace,
    display_name: profile?.display_name ?? namespace,
    verified: profile?.verified ?? false,
  };
}

export function namespaceProfile({
  namespace,
  bootstrap,
}: {
  namespace: string;
  bootstrap: RegistryBootstrap;
}): RegistryNamespaceProfile | undefined {
  const profile = bootstrap.namespaces[namespace]?.profile;
  if (profile === undefined) return undefined;
  return {
    namespace,
    display_name: profile.display_name,
    ...(profile.url === undefined ? {} : {url: profile.url}),
    verified: profile.verified,
  };
}

export function buildPackageIndex({
  row,
  versions,
}: {
  row: PublicPackage;
  versions: IndexedVersion[];
}): RegistryPackageIndex {
  return {
    package: row.name,
    kind: row.kind as RegistryPackageIndex['kind'],
    versions: versions.map((version) => ({
      version: version.version,
      digest: version.contentDigest,
      published_at: version.publishedAt.toISOString(),
      ...(version.bump === null ? {} : {bump: version.bump as 'major' | 'minor' | 'patch'}),
      capability_change: version.capabilityChange,
    })),
  };
}

// An offset cursor: the catalog is small, and a page shifts by at most the publishes between fetches.
function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const text = Buffer.from(cursor, 'base64url').toString();
  if (!OFFSET_PATTERN.test(text) || encodeCursor(Number(text)) !== cursor)
    throw new InvalidCursorError();
  return Number(text);
}
