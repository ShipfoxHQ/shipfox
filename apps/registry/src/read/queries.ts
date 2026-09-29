import {compareRegistryVersions, type RegistryEnvelope} from '@shipfox/registry-format';
import {and, asc, eq, ilike, or, sql} from 'drizzle-orm';
import {db} from '#db/db.js';
import {packages} from '#db/schema/packages.js';
import {versions} from '#db/schema/versions.js';

// Every read is anonymous, so a package that is not public looks like a package that does not exist.
const PUBLIC = eq(packages.visibility, 'public');

export type PublicPackage = typeof packages.$inferSelect;

export interface CatalogFilter {
  kind?: 'action' | 'template' | undefined;
  query?: string | undefined;
}

export function listPublicPackages({kind, query}: CatalogFilter): Promise<PublicPackage[]> {
  const search = query === undefined ? undefined : `%${escapeLike(query)}%`;
  return db()
    .select()
    .from(packages)
    .where(
      and(
        PUBLIC,
        kind === undefined ? undefined : eq(packages.kind, kind),
        search === undefined
          ? undefined
          : or(
              ilike(packages.name, search),
              ilike(packages.title, search),
              ilike(packages.summary, search),
              ilike(sql`${packages.keywords}::text`, search),
              ilike(sql`${packages.integrations}::text`, search),
            ),
      ),
    )
    .orderBy(asc(packages.name));
}

export async function findPublicPackage(name: string): Promise<PublicPackage | undefined> {
  const [row] = await db()
    .select()
    .from(packages)
    .where(and(PUBLIC, eq(packages.name, name)));
  return row;
}

export interface IndexedVersion {
  version: string;
  contentDigest: string;
  publishedAt: Date;
  bump: string | null;
  capabilityChange: boolean;
}

/** Every version of a package, lowest first. */
export async function listVersions(name: string): Promise<IndexedVersion[]> {
  const rows = await db()
    .select({
      version: versions.version,
      contentDigest: versions.contentDigest,
      publishedAt: versions.publishedAt,
      bump: versions.bump,
      capabilityChange: versions.capabilityChange,
    })
    .from(versions)
    .where(eq(versions.package, name));
  return rows.sort((a, b) => compareRegistryVersions(a.version, b.version));
}

export interface ReadableVersion {
  kind: string;
  envelope: RegistryEnvelope;
  readme: string | null;
  contentDigest: string;
  sourceDigest: string;
}

export async function findReadableVersion({
  package: name,
  version,
}: {
  package: string;
  version: string;
}): Promise<ReadableVersion | undefined> {
  const [row] = await db()
    .select({
      kind: packages.kind,
      envelope: versions.envelope,
      readme: versions.readme,
      contentDigest: versions.contentDigest,
      sourceDigest: versions.sourceDigest,
    })
    .from(versions)
    .innerJoin(packages, eq(packages.name, versions.package))
    .where(and(PUBLIC, eq(versions.package, name), eq(versions.version, version)));
  return row && {...row, envelope: row.envelope as RegistryEnvelope};
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
