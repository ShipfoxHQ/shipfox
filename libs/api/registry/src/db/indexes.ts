import {and, eq, ne} from 'drizzle-orm';
import type {RegistryIndex} from '#core/registry-index.js';
import {db} from './db.js';
import {registryIndexes} from './schema/indexes.js';

interface IndexKey {
  registry: string;
  key: string;
}

export async function getRegistryIndex(key: IndexKey): Promise<RegistryIndex | undefined> {
  const [row] = await db()
    .select()
    .from(registryIndexes)
    .where(and(eq(registryIndexes.registry, key.registry), eq(registryIndexes.key, key.key)))
    .limit(1);
  return row;
}

/** Keeps the last good copy: a later write replaces the body, the etag, and the fetch time. */
export async function upsertRegistryIndex(index: RegistryIndex): Promise<void> {
  const {registry, key, ...values} = index;
  await db()
    .insert(registryIndexes)
    .values(index)
    .onConflictDoUpdate({target: [registryIndexes.registry, registryIndexes.key], set: values});
}

/** The registry confirmed the stored copy is current. */
export async function touchRegistryIndex(params: IndexKey & {fetchedAt: Date}): Promise<void> {
  await db()
    .update(registryIndexes)
    .set({fetchedAt: params.fetchedAt})
    .where(and(eq(registryIndexes.registry, params.registry), eq(registryIndexes.key, params.key)));
}

export async function deleteRegistryIndex(key: IndexKey): Promise<void> {
  await db()
    .delete(registryIndexes)
    .where(and(eq(registryIndexes.registry, key.registry), eq(registryIndexes.key, key.key)));
}

export async function deleteIndexesOfOtherRegistries(params: {registry: string}): Promise<number> {
  const deleted = await db()
    .delete(registryIndexes)
    .where(ne(registryIndexes.registry, params.registry))
    .returning({key: registryIndexes.key});
  return deleted.length;
}
