import {and, asc, eq, like, notInArray, sql} from 'drizzle-orm';
import type {CacheDeletionReason, CacheEntry} from '#core/entities/cache-entry.js';
import {cacheDeletionCount} from '#metrics/instance.js';
import {db} from './db.js';
import {cacheDeletions} from './schema/deletions.js';
import {cacheEntries, toCacheEntry} from './schema/entries.js';
import {cacheWorkspaceSettings} from './schema/workspace-settings.js';

export interface EntryIdentity {
  projectId: string;
  scope: string;
  key: string;
  version: string;
}

export interface InsertUploadingEntryParams extends EntryIdentity {
  workspaceId: string;
  sizeBytes: number;
  sha256: string;
  createdByRunId: string;
  createdByJobExecutionId: string;
}

/** Returns `undefined` when the identity is taken, so the unique index decides concurrent reserves. */
export async function insertUploadingEntry(
  params: InsertUploadingEntryParams,
): Promise<CacheEntry | undefined> {
  const [row] = await db()
    .insert(cacheEntries)
    .values({
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      scope: params.scope,
      key: params.key,
      version: params.version,
      status: 'uploading',
      sizeBytes: params.sizeBytes,
      sha256: params.sha256,
      createdByRunId: params.createdByRunId,
      createdByJobExecutionId: params.createdByJobExecutionId,
    })
    .onConflictDoNothing()
    .returning();
  return row ? toCacheEntry(row) : undefined;
}

export async function findEntryByIdentity(params: EntryIdentity): Promise<CacheEntry | undefined> {
  const [row] = await db().select().from(cacheEntries).where(identityCondition(params)).limit(1);
  return row ? toCacheEntry(row) : undefined;
}

export async function findEntryById(params: {
  id: string;
  projectId: string;
}): Promise<CacheEntry | undefined> {
  const [row] = await db()
    .select()
    .from(cacheEntries)
    .where(and(eq(cacheEntries.id, params.id), eq(cacheEntries.projectId, params.projectId)))
    .limit(1);
  return row ? toCacheEntry(row) : undefined;
}

export async function findReadyEntryByKey(params: EntryIdentity): Promise<CacheEntry | undefined> {
  const [row] = await db()
    .select()
    .from(cacheEntries)
    .where(and(identityCondition(params), eq(cacheEntries.status, 'ready')))
    .limit(1);
  return row ? toCacheEntry(row) : undefined;
}

export async function findNewestReadyEntryByPrefix(params: {
  projectId: string;
  scope: string;
  version: string;
  prefix: string;
}): Promise<CacheEntry | undefined> {
  const [row] = await db()
    .select()
    .from(cacheEntries)
    .where(
      and(
        eq(cacheEntries.projectId, params.projectId),
        eq(cacheEntries.scope, params.scope),
        eq(cacheEntries.version, params.version),
        eq(cacheEntries.status, 'ready'),
        like(cacheEntries.key, `${escapeLikePattern(params.prefix)}%`),
      ),
    )
    .orderBy(sql`${cacheEntries.committedAt} desc nulls last`)
    .limit(1);
  return row ? toCacheEntry(row) : undefined;
}

export async function setUploadId(params: {id: string; uploadId: string}): Promise<void> {
  await db()
    .update(cacheEntries)
    .set({uploadId: params.uploadId})
    .where(eq(cacheEntries.id, params.id));
}

/** Returns `undefined` when the entry is not uploading, such as after a concurrent commit. */
export async function markEntryReady(id: string): Promise<CacheEntry | undefined> {
  const [row] = await db()
    .update(cacheEntries)
    .set({
      status: 'ready',
      uploadId: null,
      committedAt: sql`now()`,
      lastAccessedAt: sql`now()`,
    })
    .where(and(eq(cacheEntries.id, id), eq(cacheEntries.status, 'uploading')))
    .returning();
  return row ? toCacheEntry(row) : undefined;
}

/** Retention and eviction read `last_accessed_at` with hour precision, so a fresher value is skipped. */
export async function touchEntry(id: string): Promise<void> {
  await db()
    .update(cacheEntries)
    .set({lastAccessedAt: sql`now()`})
    .where(
      and(eq(cacheEntries.id, id), sql`${cacheEntries.lastAccessedAt} < now() - interval '1 hour'`),
    );
}

/** Returns whether a row was deleted. An entry that became ready meanwhile stays. */
export async function deleteUploadingEntry(id: string): Promise<boolean> {
  const deleted = await db()
    .delete(cacheEntries)
    .where(and(eq(cacheEntries.id, id), eq(cacheEntries.status, 'uploading')))
    .returning({id: cacheEntries.id});
  return deleted.length > 0;
}

/**
 * Deletes the row and records why, together, so the history never disagrees with the index.
 * Returns whether this call deleted the row.
 */
export async function deleteReadyEntry(params: {
  entry: CacheEntry;
  reason: CacheDeletionReason;
}): Promise<boolean> {
  const {entry, reason} = params;
  const deleted = await db().transaction(async (tx) => {
    const rows = await tx
      .delete(cacheEntries)
      .where(and(eq(cacheEntries.id, entry.id), eq(cacheEntries.status, 'ready')))
      .returning({id: cacheEntries.id});
    if (rows.length === 0) return false;
    await tx.insert(cacheDeletions).values({
      workspaceId: entry.workspaceId,
      projectId: entry.projectId,
      scope: entry.scope,
      key: entry.key,
      sizeBytes: entry.sizeBytes,
      reason,
    });
    return true;
  });
  if (deleted) cacheDeletionCount.add(1, {reason});
  return deleted;
}

export interface ListForSweepParams {
  limit: number;
  /** Entries a deletion already failed on in this pass, left for the next one. */
  excludeIds: readonly string[];
}

/** Ready entries idle for longer than their workspace's retention, oldest first. */
export async function listExpiredEntries(
  params: ListForSweepParams & {defaultRetentionDays: number},
): Promise<CacheEntry[]> {
  const rows = await db()
    .select({entry: cacheEntries})
    .from(cacheEntries)
    .leftJoin(
      cacheWorkspaceSettings,
      eq(cacheWorkspaceSettings.workspaceId, cacheEntries.workspaceId),
    )
    .where(
      and(
        eq(cacheEntries.status, 'ready'),
        sql`${cacheEntries.lastAccessedAt} < now() - make_interval(days => coalesce(${cacheWorkspaceSettings.retentionDays}, ${params.defaultRetentionDays}::int))`,
        excludeCondition(params.excludeIds),
      ),
    )
    .orderBy(asc(cacheEntries.lastAccessedAt))
    .limit(params.limit);
  return rows.map((row) => toCacheEntry(row.entry));
}

export async function listStaleUploadingEntries(
  params: ListForSweepParams & {olderThanSeconds: number},
): Promise<CacheEntry[]> {
  const rows = await db()
    .select()
    .from(cacheEntries)
    .where(
      and(
        eq(cacheEntries.status, 'uploading'),
        sql`${cacheEntries.createdAt} < now() - make_interval(secs => ${params.olderThanSeconds})`,
        excludeCondition(params.excludeIds),
      ),
    )
    .orderBy(asc(cacheEntries.createdAt))
    .limit(params.limit);
  return rows.map(toCacheEntry);
}

export async function listLeastRecentlyUsedEntries(
  params: ListForSweepParams & {workspaceId: string},
): Promise<CacheEntry[]> {
  const rows = await db()
    .select()
    .from(cacheEntries)
    .where(
      and(
        eq(cacheEntries.workspaceId, params.workspaceId),
        eq(cacheEntries.status, 'ready'),
        excludeCondition(params.excludeIds),
      ),
    )
    .orderBy(asc(cacheEntries.lastAccessedAt))
    .limit(params.limit);
  return rows.map(toCacheEntry);
}

const storedBytes = sql<string>`coalesce(sum(${cacheEntries.sizeBytes}), 0)`;

/** Stored bytes are the committed entries only. Uploads in flight count for nothing. */
export async function sumStoredBytes(workspaceId?: string): Promise<number> {
  const [row] = await db()
    .select({storedBytes})
    .from(cacheEntries)
    .where(
      and(
        eq(cacheEntries.status, 'ready'),
        workspaceId ? eq(cacheEntries.workspaceId, workspaceId) : undefined,
      ),
    );
  return Number(row?.storedBytes ?? 0);
}

export async function listWorkspacesWithEntries(): Promise<string[]> {
  const rows = await db()
    .selectDistinct({workspaceId: cacheEntries.workspaceId})
    .from(cacheEntries)
    .where(eq(cacheEntries.status, 'ready'));
  return rows.map((row) => row.workspaceId);
}

function excludeCondition(ids: readonly string[]) {
  return ids.length > 0 ? notInArray(cacheEntries.id, [...ids]) : undefined;
}

function identityCondition(params: EntryIdentity) {
  return and(
    eq(cacheEntries.projectId, params.projectId),
    eq(cacheEntries.scope, params.scope),
    eq(cacheEntries.key, params.key),
    eq(cacheEntries.version, params.version),
  );
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export interface ProjectStorage {
  workspaceId: string;
  projectId: string;
  storedBytes: number;
  objectCount: number;
}

/** Only `ready` rows count: parts of an unfinished upload are invisible until commit. */
export async function sumReadyStorageByProject(): Promise<ProjectStorage[]> {
  const rows = await db()
    .select({
      workspaceId: cacheEntries.workspaceId,
      projectId: cacheEntries.projectId,
      storedBytes: sql<string>`sum(${cacheEntries.sizeBytes})`,
      objectCount: sql<string>`count(*)`,
    })
    .from(cacheEntries)
    .where(eq(cacheEntries.status, 'ready'))
    .groupBy(cacheEntries.workspaceId, cacheEntries.projectId);
  return rows.map((row) => ({
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    storedBytes: Number(row.storedBytes),
    objectCount: Number(row.objectCount),
  }));
}
