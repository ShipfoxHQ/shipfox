import {and, eq, isNull, ne} from 'drizzle-orm';
import type {RegistryVersion} from '#core/registry-version.js';
import {db} from './db.js';
import {registryVersions, toRegistryVersion} from './schema/versions.js';

interface VersionKey {
  registry: string;
  package: string;
  version: string;
}

function whereKey({registry, package: packageName, version}: VersionKey) {
  return and(
    eq(registryVersions.registry, registry),
    eq(registryVersions.package, packageName),
    eq(registryVersions.version, version),
  );
}

export async function getRegistryVersion(key: VersionKey): Promise<RegistryVersion | undefined> {
  const [row] = await db().select().from(registryVersions).where(whereKey(key)).limit(1);
  return row ? toRegistryVersion(row) : undefined;
}

/** Versions are immutable, so a concurrent insert of the same version is a no-op. */
export async function insertRegistryVersion(version: RegistryVersion): Promise<void> {
  await db()
    .insert(registryVersions)
    .values({
      ...version,
      content: Buffer.from(version.content),
      source: version.source === null ? null : Buffer.from(version.source),
    })
    .onConflictDoNothing();
}

export async function deleteRegistryVersion(key: VersionKey): Promise<void> {
  await db().delete(registryVersions).where(whereKey(key));
}

export async function deleteVersionsOfOtherRegistries(params: {registry: string}): Promise<number> {
  const deleted = await db()
    .delete(registryVersions)
    .where(ne(registryVersions.registry, params.registry))
    .returning({package: registryVersions.package});
  return deleted.length;
}

export async function setRegistryVersionSource(
  params: VersionKey & {source: Uint8Array},
): Promise<void> {
  await db()
    .update(registryVersions)
    .set({source: Buffer.from(params.source)})
    .where(and(whereKey(params), isNull(registryVersions.source)));
}

export async function setRegistryVersionReadme(
  params: VersionKey & {readme: string},
): Promise<void> {
  await db()
    .update(registryVersions)
    .set({readme: params.readme})
    .where(and(whereKey(params), isNull(registryVersions.readme)));
}
