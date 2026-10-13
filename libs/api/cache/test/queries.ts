import {and, eq} from 'drizzle-orm';
import type {CacheDeletionReason, CacheEntry} from '#core/entities/cache-entry.js';
import {db} from '#db/db.js';
import {cacheDeletions} from '#db/schema/deletions.js';
import {cacheEntries, toCacheEntry} from '#db/schema/entries.js';

export async function findEntryRow(params: {
  projectId: string;
  scope: string;
  key: string;
}): Promise<CacheEntry | undefined> {
  const [row] = await db()
    .select()
    .from(cacheEntries)
    .where(
      and(
        eq(cacheEntries.projectId, params.projectId),
        eq(cacheEntries.scope, params.scope),
        eq(cacheEntries.key, params.key),
      ),
    )
    .limit(1);
  return row ? toCacheEntry(row) : undefined;
}

export async function findEntryRowById(id: string): Promise<CacheEntry | undefined> {
  const [row] = await db().select().from(cacheEntries).where(eq(cacheEntries.id, id)).limit(1);
  return row ? toCacheEntry(row) : undefined;
}

export async function listDeletionReasons(projectId: string): Promise<CacheDeletionReason[]> {
  const rows = await db()
    .select({reason: cacheDeletions.reason})
    .from(cacheDeletions)
    .where(eq(cacheDeletions.projectId, projectId));
  return rows.map((row) => row.reason);
}

export async function setLastAccessedAt(params: {id: string; at: Date}): Promise<void> {
  await db()
    .update(cacheEntries)
    .set({lastAccessedAt: params.at})
    .where(eq(cacheEntries.id, params.id));
}

export async function setCommittedAt(params: {id: string; at: Date}): Promise<void> {
  await db()
    .update(cacheEntries)
    .set({committedAt: params.at})
    .where(eq(cacheEntries.id, params.id));
}
