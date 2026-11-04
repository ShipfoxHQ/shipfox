import {recordDeletedScope} from '@shipfox/node-drizzle';
import {and, asc, eq, isNull, sql} from 'drizzle-orm';
import type {CacheEntry} from '#core/entities/cache-entry.js';
import {db} from './db.js';
import {cacheDeletedScopes} from './schema/deleted-scopes.js';
import {cacheEntries, toCacheEntry} from './schema/entries.js';

export async function recordProjectCacheDeleted(params: {
  workspaceId: string;
  projectId: string;
}): Promise<void> {
  await db().transaction((tx) =>
    recordDeletedScope(tx, cacheDeletedScopes, {
      scope: {workspaceId: params.workspaceId, projectId: params.projectId},
      reason: 'project_deleted',
    }),
  );
}

/** Entries of any status, so an upload in flight is purged too. */
export async function listProjectEntries(params: {
  projectId: string;
  limit: number;
}): Promise<CacheEntry[]> {
  const rows = await db()
    .select()
    .from(cacheEntries)
    .where(eq(cacheEntries.projectId, params.projectId))
    .orderBy(asc(cacheEntries.id))
    .limit(params.limit);
  return rows.map(toCacheEntry);
}

/** Removes the row with no deletion record: the project is gone, so nobody asks where it went. */
export async function deleteProjectEntryRow(id: string): Promise<void> {
  await db().delete(cacheEntries).where(eq(cacheEntries.id, id));
}

/** Sets `purged_at` once no entry of the project remains. Answers whether it did. */
export async function markProjectCachePurged(params: {
  workspaceId: string;
  projectId: string;
}): Promise<boolean> {
  const remaining = await db().execute(
    sql`select 1 from ${cacheEntries} where ${cacheEntries.projectId} = ${params.projectId} limit 1`,
  );
  if (remaining.rows.length > 0) return false;
  await db()
    .update(cacheDeletedScopes)
    .set({purgedAt: new Date()})
    .where(
      and(
        eq(cacheDeletedScopes.workspaceId, params.workspaceId),
        eq(cacheDeletedScopes.projectId, params.projectId),
        isNull(cacheDeletedScopes.purgedAt),
      ),
    );
  return true;
}
