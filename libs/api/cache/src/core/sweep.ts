import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {pruneDeletions} from '#db/deletions.js';
import {
  listExpiredEntries,
  listStaleUploadingEntries,
  listWorkspacesWithEntries,
} from '#db/entries.js';
import {cacheSweepDuration} from '#metrics/instance.js';
import {deleteEntry, deleteStaleUpload} from './delete-entry.js';
import type {CacheEntry} from './entities/cache-entry.js';
import {evictWorkspace} from './evict-workspace.js';
import type {WorkspaceStorageLimits} from './storage-policy.js';

// An upload can be live for as long as its signed URLs, so the cutoff stays past their lifetime.
const STALE_UPLOAD_AFTER_SECONDS = Math.max(2 * 60 * 60, config.CACHE_URL_TTL_SECONDS + 60 * 60);
const DELETION_RECORD_RETENTION_DAYS = 30;

export interface CacheSweepResult {
  expired: number;
  /** Stale uploads removed with their multipart upload. */
  reaped: number;
  evicted: number;
  /** Entries whose deletion threw. They stay for the next pass. */
  failed: number;
  deletionRecordsPruned: number;
  /** True when the pass stopped on its wall-clock budget with work likely remaining. */
  timedOut: boolean;
}

export interface RunCacheSweepParams {
  limits: WorkspaceStorageLimits;
  batchLimit: number;
  timeBudgetMs: number;
  /** Wall clock, injectable so a test can spend the budget. */
  now?: (() => number) | undefined;
  /** Liveness signal, such as the activity heartbeat. Invoked once per processed entry. */
  onProgress?: (() => void) | undefined;
}

interface SweepPass {
  result: CacheSweepResult;
  /** Reports progress, then tells whether the budget still allows another deletion. */
  proceed(): boolean;
}

/**
 * One pass: expire idle entries, reap stale uploads, evict workspaces over their limit, and prune
 * old deletion records. The loop bounds itself because a Temporal timeout marks the activity
 * failed but does not stop JS that is already running.
 */
export async function runCacheSweep(params: RunCacheSweepParams): Promise<CacheSweepResult> {
  const now = params.now ?? Date.now;
  const startedAt = now();
  const deadline = startedAt + params.timeBudgetMs;
  const pass: SweepPass = {
    result: {
      expired: 0,
      reaped: 0,
      evicted: 0,
      failed: 0,
      deletionRecordsPruned: 0,
      timedOut: false,
    },
    proceed() {
      params.onProgress?.();
      if (now() < deadline) return true;
      pass.result.timedOut = true;
      return false;
    },
  };

  await drain(pass, {
    list: (excludeIds) =>
      listExpiredEntries({
        defaultRetentionDays: config.CACHE_DEFAULT_RETENTION_DAYS,
        limit: params.batchLimit,
        excludeIds,
      }),
    remove: (entry) => deleteEntry({entry, reason: 'expired'}),
    counter: 'expired',
  });
  await drain(pass, {
    list: (excludeIds) =>
      listStaleUploadingEntries({
        olderThanSeconds: STALE_UPLOAD_AFTER_SECONDS,
        limit: params.batchLimit,
        excludeIds,
      }),
    remove: deleteStaleUpload,
    counter: 'reaped',
  });
  await evictWorkspaces(pass, params.limits);
  if (!pass.result.timedOut) {
    pass.result.deletionRecordsPruned = await pruneDeletions({
      olderThanDays: DELETION_RECORD_RETENTION_DAYS,
    });
  }

  cacheSweepDuration.record(now() - startedAt, {
    outcome: pass.result.timedOut ? 'timed_out' : 'completed',
  });
  return pass.result;
}

// Every listed entry is either removed, so it is not listed again, or excluded after a failure.
async function drain(
  pass: SweepPass,
  phase: {
    list: (excludeIds: readonly string[]) => Promise<CacheEntry[]>;
    remove: (entry: CacheEntry) => Promise<boolean>;
    counter: 'expired' | 'reaped';
  },
): Promise<void> {
  const failedIds: string[] = [];
  while (!pass.result.timedOut) {
    const batch = await phase.list(failedIds);
    if (batch.length === 0) return;

    for (const entry of batch) {
      if (!pass.proceed()) return;
      try {
        if (await phase.remove(entry)) pass.result[phase.counter] += 1;
      } catch (error) {
        failedIds.push(entry.id);
        pass.result.failed += 1;
        logger().error({err: error, entryId: entry.id}, 'Failed to delete a cache entry');
        reportError(error, {boundary: 'cache.maintenance', extra: {entryId: entry.id}});
      }
    }
  }
}

async function evictWorkspaces(pass: SweepPass, limits: WorkspaceStorageLimits): Promise<void> {
  if (pass.result.timedOut) return;
  for (const workspaceId of await listWorkspacesWithEntries()) {
    if (!pass.proceed()) return;
    const {evicted, failed} = await evictWorkspace({workspaceId, limits, onEntry: pass.proceed});
    pass.result.evicted += evicted;
    pass.result.failed += failed;
  }
}
