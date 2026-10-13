import {
  createTimestampIdCursor,
  encodeTimestampIdCursor,
  type TimestampIdCursor,
  timestampIdCursorColumn,
  timestampIdCursorWhere,
} from '@shipfox/node-drizzle';
import {and, desc, eq, getTableColumns, like, sql} from 'drizzle-orm';
import type {CacheDeletionReason, CacheEntry} from '#core/entities/cache-entry.js';
import {db} from './db.js';
import {escapeLikePattern} from './entries.js';
import {cacheDeletions} from './schema/deletions.js';
import {cacheEntries, toCacheEntry} from './schema/entries.js';
import {cacheWorkspaceSettings} from './schema/workspace-settings.js';

export interface ScopeSummary {
  scope: string;
  entryCount: number;
  sizeBytes: number;
  lastUsedAt: Date;
}

/** Committed entries only: an upload in flight is not an entry yet. */
export async function listScopeSummaries(projectId: string): Promise<ScopeSummary[]> {
  const lastUsedAt = sql<Date>`max(${cacheEntries.lastAccessedAt})`;
  const rows = await db()
    .select({
      scope: cacheEntries.scope,
      entryCount: sql<string>`count(*)`,
      sizeBytes: sql<string>`sum(${cacheEntries.sizeBytes})`,
      lastUsedAt: lastUsedAt.mapWith((value) => new Date(value)),
    })
    .from(cacheEntries)
    .where(and(eq(cacheEntries.projectId, projectId), eq(cacheEntries.status, 'ready')))
    .groupBy(cacheEntries.scope)
    .orderBy(desc(lastUsedAt), cacheEntries.scope);
  return rows.map((row) => ({
    scope: row.scope,
    entryCount: Number(row.entryCount),
    sizeBytes: Number(row.sizeBytes),
    lastUsedAt: row.lastUsedAt,
  }));
}

export interface ListReadyEntriesParams {
  projectId: string;
  scope?: string | undefined;
  keyPrefix?: string | undefined;
  cursor?: TimestampIdCursor | undefined;
  limit: number;
}

export interface ReadyEntriesPage {
  entries: {
    entry: CacheEntry;
    /** The cursor of the page that starts right after this entry. */
    cursor: string;
  }[];
  hasMore: boolean;
}

/** Newest first. A cursor keeps its microseconds, so rows saved in one millisecond keep order. */
export async function listReadyEntries(params: ListReadyEntriesParams): Promise<ReadyEntriesPage> {
  const cursorCondition = timestampIdCursorWhere({
    timestampColumn: cacheEntries.createdAt,
    idColumn: cacheEntries.id,
    cursor: params.cursor,
  });
  const rows = await db()
    .select({
      ...getTableColumns(cacheEntries),
      cursorCreatedAt: timestampIdCursorColumn(cacheEntries.createdAt),
    })
    .from(cacheEntries)
    .where(
      and(
        eq(cacheEntries.projectId, params.projectId),
        eq(cacheEntries.status, 'ready'),
        params.scope === undefined ? undefined : eq(cacheEntries.scope, params.scope),
        params.keyPrefix === undefined
          ? undefined
          : like(cacheEntries.key, `${escapeLikePattern(params.keyPrefix)}%`),
        cursorCondition,
      ),
    )
    .orderBy(desc(cacheEntries.createdAt), desc(cacheEntries.id))
    .limit(params.limit + 1);
  const pageRows = rows.slice(0, params.limit);
  return {
    entries: pageRows.map((row) => ({
      entry: toCacheEntry(row),
      cursor: encodeTimestampIdCursor(
        createTimestampIdCursor({createdAt: row.cursorCreatedAt, id: row.id}),
      ),
    })),
    hasMore: rows.length > params.limit,
  };
}

/** Committed entries of one stored scope. */
export async function listReadyEntriesInScope(params: {
  projectId: string;
  scope: string;
  limit: number;
}): Promise<CacheEntry[]> {
  const rows = await db()
    .select()
    .from(cacheEntries)
    .where(
      and(
        eq(cacheEntries.projectId, params.projectId),
        eq(cacheEntries.scope, params.scope),
        eq(cacheEntries.status, 'ready'),
      ),
    )
    .limit(params.limit);
  return rows.map(toCacheEntry);
}

export async function findReadyEntryInProject(params: {
  id: string;
  projectId: string;
}): Promise<CacheEntry | undefined> {
  const [row] = await db()
    .select()
    .from(cacheEntries)
    .where(
      and(
        eq(cacheEntries.id, params.id),
        eq(cacheEntries.projectId, params.projectId),
        eq(cacheEntries.status, 'ready'),
      ),
    )
    .limit(1);
  return row ? toCacheEntry(row) : undefined;
}

export interface ProjectStorageTotal {
  projectId: string;
  storedBytes: number;
  entryCount: number;
}

export async function sumStoredBytesByProject(workspaceId: string): Promise<ProjectStorageTotal[]> {
  const storedBytes = sql<string>`sum(${cacheEntries.sizeBytes})`;
  const rows = await db()
    .select({
      projectId: cacheEntries.projectId,
      storedBytes,
      entryCount: sql<string>`count(*)`,
    })
    .from(cacheEntries)
    .where(and(eq(cacheEntries.workspaceId, workspaceId), eq(cacheEntries.status, 'ready')))
    .groupBy(cacheEntries.projectId)
    .orderBy(desc(storedBytes), cacheEntries.projectId);
  return rows.map((row) => ({
    projectId: row.projectId,
    storedBytes: Number(row.storedBytes),
    entryCount: Number(row.entryCount),
  }));
}

export interface RecordedDeletion {
  projectId: string;
  scope: string;
  key: string;
  sizeBytes: number;
  reason: CacheDeletionReason;
  deletedAt: Date;
}

export async function listRecentDeletions(params: {
  workspaceId: string;
  limit: number;
}): Promise<RecordedDeletion[]> {
  const rows = await db()
    .select()
    .from(cacheDeletions)
    .where(eq(cacheDeletions.workspaceId, params.workspaceId))
    .orderBy(desc(cacheDeletions.deletedAt), desc(cacheDeletions.id))
    .limit(params.limit);
  return rows.map((row) => ({
    projectId: row.projectId,
    scope: row.scope,
    key: row.key,
    sizeBytes: row.sizeBytes,
    reason: row.reason,
    deletedAt: row.deletedAt,
  }));
}

export async function findWorkspaceRetentionDays(workspaceId: string): Promise<number | undefined> {
  const [row] = await db()
    .select({retentionDays: cacheWorkspaceSettings.retentionDays})
    .from(cacheWorkspaceSettings)
    .where(eq(cacheWorkspaceSettings.workspaceId, workspaceId))
    .limit(1);
  return row?.retentionDays;
}

export async function upsertWorkspaceRetentionDays(params: {
  workspaceId: string;
  retentionDays: number;
}): Promise<void> {
  await db()
    .insert(cacheWorkspaceSettings)
    .values({workspaceId: params.workspaceId, retentionDays: params.retentionDays})
    .onConflictDoUpdate({
      target: cacheWorkspaceSettings.workspaceId,
      set: {retentionDays: params.retentionDays, updatedAt: sql`now()`},
    });
}
