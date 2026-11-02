import type {Buffer} from 'node:buffer';
import {and, eq} from 'drizzle-orm';
import {db, type ManagedTx} from './db.js';
import {managedObjects} from './schema/objects.js';

export interface StoredObject {
  oid: string;
  data: Buffer;
}

export async function getObjectData(params: {
  repositoryId: string;
  oid: string;
}): Promise<Buffer | undefined> {
  const [row] = await db()
    .select({data: managedObjects.data})
    .from(managedObjects)
    .where(
      and(eq(managedObjects.repositoryId, params.repositoryId), eq(managedObjects.oid, params.oid)),
    )
    .limit(1);
  return row?.data;
}

/** Objects are content-addressed, so a row that already exists holds the same bytes. */
export async function insertObjects(
  params: {repositoryId: string; objects: readonly StoredObject[]},
  options: {tx?: ManagedTx} = {},
): Promise<void> {
  if (params.objects.length === 0) return;
  await (options.tx ?? db())
    .insert(managedObjects)
    .values(params.objects.map((object) => ({repositoryId: params.repositoryId, ...object})))
    .onConflictDoNothing();
}
