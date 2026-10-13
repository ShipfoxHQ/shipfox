import {and, eq, like, sql} from 'drizzle-orm';
import type {CacheDeletionReason, CacheEntry} from '#core/entities/cache-entry.js';
import {db} from './db.js';
import {cacheDeletions} from './schema/deletions.js';
import {cacheEntries, toCacheEntry} from './schema/entries.js';

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

export async function deleteUploadingEntry(id: string): Promise<void> {
  await db()
    .delete(cacheEntries)
    .where(and(eq(cacheEntries.id, id), eq(cacheEntries.status, 'uploading')));
}

/** Deletes the row and records why, together, so the history never disagrees with the index. */
export async function deleteReadyEntry(params: {
  entry: CacheEntry;
  reason: CacheDeletionReason;
}): Promise<void> {
  const {entry, reason} = params;
  await db().transaction(async (tx) => {
    const deleted = await tx
      .delete(cacheEntries)
      .where(and(eq(cacheEntries.id, entry.id), eq(cacheEntries.status, 'ready')))
      .returning({id: cacheEntries.id});
    if (deleted.length === 0) return;
    await tx.insert(cacheDeletions).values({
      workspaceId: entry.workspaceId,
      projectId: entry.projectId,
      scope: entry.scope,
      key: entry.key,
      sizeBytes: entry.sizeBytes,
      reason,
    });
  });
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
