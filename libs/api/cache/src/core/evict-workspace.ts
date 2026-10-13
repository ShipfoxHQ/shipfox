import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {listLeastRecentlyUsedEntries, sumStoredBytes} from '#db/entries.js';
import {deleteEntry} from './delete-entry.js';
import type {CacheEntry} from './entities/cache-entry.js';
import type {WorkspaceStorageLimits} from './storage-policy.js';

const EVICTION_BATCH_LIMIT = 100;

export interface EvictWorkspaceParams {
  workspaceId: string;
  limits: WorkspaceStorageLimits;
  /** The entry a commit just made ready, which this eviction must leave in place. */
  keepEntryId?: string | undefined;
  /** Invoked before each deletion. Return `false` to stop, such as on a spent time budget. */
  onEntry?: (() => boolean) | undefined;
}

export interface EvictWorkspaceResult {
  evicted: number;
  failed: number;
}

/**
 * Deletes the least recently used entries of a workspace until its stored bytes fit its limit.
 * The sweeper and commit both call it. An entry whose deletion fails is skipped and stays for the
 * next call.
 */
export async function evictWorkspace(params: EvictWorkspaceParams): Promise<EvictWorkspaceResult> {
  const result: EvictWorkspaceResult = {evicted: 0, failed: 0};
  const maxStoredBytes = await params.limits.maxStoredBytes(params.workspaceId);
  if (maxStoredBytes === null) return result;

  const eviction: Eviction = {
    result,
    excessBytes: (await sumStoredBytes(params.workspaceId)) - maxStoredBytes,
    excludeIds: params.keepEntryId ? [params.keepEntryId] : [],
    onEntry: params.onEntry,
  };
  while (eviction.excessBytes > 0) {
    const batch = await listLeastRecentlyUsedEntries({
      workspaceId: params.workspaceId,
      limit: EVICTION_BATCH_LIMIT,
      excludeIds: eviction.excludeIds,
    });
    if (batch.length === 0 || !(await evictBatch(batch, eviction))) break;
  }
  return result;
}

interface Eviction {
  result: EvictWorkspaceResult;
  excessBytes: number;
  excludeIds: string[];
  onEntry: EvictWorkspaceParams['onEntry'];
}

/** Returns `false` when the caller asked to stop. */
async function evictBatch(batch: readonly CacheEntry[], eviction: Eviction): Promise<boolean> {
  for (const entry of batch) {
    if (eviction.excessBytes <= 0) return true;
    if (eviction.onEntry?.() === false) return false;
    try {
      if (await deleteEntry({entry, reason: 'evicted'})) eviction.result.evicted += 1;
      // A row another caller removed frees the same bytes.
      eviction.excessBytes -= entry.sizeBytes;
    } catch (error) {
      eviction.excludeIds.push(entry.id);
      eviction.result.failed += 1;
      logger().error({err: error, entryId: entry.id}, 'Failed to evict a cache entry');
      reportError(error, {boundary: 'cache.maintenance', extra: {entryId: entry.id}});
    }
  }
  return true;
}
