import {decodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {listReadyEntries} from '#db/management.js';
import type {CacheEntry} from './entities/cache-entry.js';
import {InvalidCursorError} from './errors.js';
import {type DevSandbox, parseDevSandbox} from './scopes.js';

export interface ManagedCacheEntry {
  id: string;
  /** The stored scope, which is `dev/{userId}/{scope}` for a dev sandbox. */
  scope: string;
  devSandbox: DevSandbox | null;
  key: string;
  sizeBytes: number;
  createdAt: Date;
  lastUsedAt: Date;
  createdByRunId: string;
  /** Continues the listing right after this entry. */
  cursor: string;
}

export interface ListCacheEntriesParams {
  projectId: string;
  scope?: string | undefined;
  keyPrefix?: string | undefined;
  cursor?: string | undefined;
  limit: number;
}

function toManagedCacheEntry(entry: CacheEntry, cursor: string): ManagedCacheEntry {
  return {
    id: entry.id,
    scope: entry.scope,
    devSandbox: parseDevSandbox(entry.scope),
    key: entry.key,
    sizeBytes: entry.sizeBytes,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastAccessedAt,
    createdByRunId: entry.createdByRunId,
    cursor,
  };
}

/** Committed entries of a project, newest first. Throws `InvalidCursorError` for a bad cursor. */
export async function listCacheEntries(
  params: ListCacheEntriesParams,
): Promise<{entries: ManagedCacheEntry[]; nextCursor: string | null}> {
  const cursor = decodeTimestampIdCursor(params.cursor);
  if (params.cursor !== undefined && cursor === undefined) throw new InvalidCursorError();

  const page = await listReadyEntries({
    projectId: params.projectId,
    scope: params.scope,
    keyPrefix: params.keyPrefix,
    cursor,
    limit: params.limit,
  });
  return {
    entries: page.entries.map(({entry, cursor}) => toManagedCacheEntry(entry, cursor)),
    nextCursor: page.hasMore ? (page.entries.at(-1)?.cursor ?? null) : null,
  };
}
