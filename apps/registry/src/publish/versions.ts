import {
  compareRegistryVersions,
  type RegistryEnvelope,
  type RegistryPackageKind,
} from '@shipfox/registry-format';
import {and, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {audit} from '#db/schema/audit.js';
import {packages} from '#db/schema/packages.js';
import {versions} from '#db/schema/versions.js';
import {VersionRefusedError} from '#publish/errors.js';

export type PackageCard = Pick<
  typeof packages.$inferInsert,
  'title' | 'summary' | 'keywords' | 'integrations'
>;

export interface StoredVersion {
  fingerprint: string;
  envelope: RegistryEnvelope;
}

export async function findPackageKind(name: string): Promise<RegistryPackageKind | undefined> {
  const [row] = await db()
    .select({kind: packages.kind})
    .from(packages)
    .where(eq(packages.name, name));
  return row?.kind as RegistryPackageKind | undefined;
}

export async function listVersionNumbers(name: string): Promise<string[]> {
  const rows = await db()
    .select({version: versions.version})
    .from(versions)
    .where(eq(versions.package, name));
  return rows.map(({version}) => version);
}

export async function findStoredVersion({
  package: name,
  version,
}: {
  package: string;
  version: string;
}): Promise<(StoredVersion & {document: unknown}) | undefined> {
  const [row] = await db()
    .select({
      fingerprint: versions.fingerprint,
      envelope: versions.envelope,
      document: versions.document,
    })
    .from(versions)
    .where(and(eq(versions.package, name), eq(versions.version, version)));
  return row && {...row, envelope: row.envelope as RegistryEnvelope};
}

/** Whether `package@version` is a published action. */
export async function actionVersionExists({
  package: name,
  version,
}: {
  package: string;
  version: string;
}): Promise<boolean> {
  const rows = await db()
    .select({version: versions.version})
    .from(versions)
    .innerJoin(packages, eq(packages.name, versions.package))
    .where(
      and(eq(versions.package, name), eq(versions.version, version), eq(packages.kind, 'action')),
    );
  return rows.length > 0;
}

export interface NewVersion {
  package: string;
  namespace: string;
  kind: RegistryPackageKind;
  version: string;
  card: PackageCard;
  envelope: RegistryEnvelope;
  document: unknown;
  fingerprint: string;
  contentDigest: string;
  sourceDigest: string;
  readme: string | undefined;
  bump: 'major' | 'minor' | 'patch' | undefined;
  capabilityChange: boolean;
  publishedAt: Date;
  auditDetail: Record<string, unknown>;
}

export type VersionWrite =
  | {outcome: 'created'; envelope: RegistryEnvelope}
  | {outcome: 'retried'; envelope: RegistryEnvelope};

/**
 * Commits a version in one transaction: the package row when it is new, its card fields when this
 * is its highest version, the version row, and the audit row. The package row stays locked, so
 * publishes of one package run one after another. A version row that exists already is a retry
 * when its fingerprint is the same, and a refusal when it is not.
 */
export function writeVersion(version: NewVersion): Promise<VersionWrite> {
  return db().transaction(async (tx) => {
    const now = version.publishedAt;
    const card = {
      ...version.card,
      latestVersion: version.version,
      latestPublishedAt: now,
    };
    await tx
      .insert(packages)
      .values({
        name: version.package,
        namespace: version.namespace,
        kind: version.kind,
        firstPublishedAt: now,
        ...card,
      })
      .onConflictDoNothing();
    const [existing] = await tx
      .select()
      .from(packages)
      .where(eq(packages.name, version.package))
      .for('update');
    if (existing === undefined)
      throw new Error(`Package ${version.package} vanished during publish`);
    if (existing.kind !== version.kind) {
      throw new VersionRefusedError(
        'kind-mismatch',
        `${version.package} is a ${existing.kind}, not a ${version.kind}`,
      );
    }

    const [stored] = await tx
      .select({fingerprint: versions.fingerprint, envelope: versions.envelope})
      .from(versions)
      .where(and(eq(versions.package, version.package), eq(versions.version, version.version)));
    if (stored) {
      if (stored.fingerprint !== version.fingerprint) throw changedWithoutBump(version);
      return {outcome: 'retried', envelope: stored.envelope as RegistryEnvelope};
    }

    if (compareRegistryVersions(version.version, existing.latestVersion) > 0) {
      await tx.update(packages).set(card).where(eq(packages.name, version.package));
    }
    await tx.insert(versions).values({
      package: version.package,
      version: version.version,
      envelope: version.envelope,
      document: version.document,
      fingerprint: version.fingerprint,
      contentDigest: version.contentDigest,
      sourceDigest: version.sourceDigest,
      readme: version.readme ?? null,
      bump: version.bump ?? null,
      capabilityChange: version.capabilityChange,
      publishedAt: now,
    });
    await tx.insert(audit).values({
      event: 'version-published',
      outcome: 'accepted',
      namespace: version.namespace,
      package: version.package,
      version: version.version,
      detail: version.auditDetail,
    });
    return {outcome: 'created', envelope: version.envelope};
  });
}

export function changedWithoutBump({package: name, version}: {package: string; version: string}) {
  return new VersionRefusedError(
    'changed-without-version-bump',
    `${name}@${version} is published with different content. Publish the changes as a new version.`,
  );
}
