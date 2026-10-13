import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {CacheDeletionReason} from '#core/entities/cache-entry.js';

const meter = instanceMetrics.getMeter('cache');

export type CacheRestoreResult = 'exact' | 'prefix' | 'miss';

export const cacheRestoreCount = meter.createCounter<{result: CacheRestoreResult}>(
  'cache_restores',
  {description: 'Cache restore lookups by result. A prefix hit matched a restore key.'},
);

export type CacheSaveResult =
  | 'reserved'
  | 'exists'
  | 'in_progress'
  | 'too_large'
  | 'committed'
  | 'aborted'
  | 'size_mismatch'
  | 'object_missing'
  | 'invalid_upload';

export const cacheSaveCount = meter.createCounter<{result: CacheSaveResult}>('cache_saves', {
  description: 'Cache save steps by result: reserve outcomes, commits, aborts, and failed commits',
});

/** A stale upload was never a visible entry, so it has a reason of its own. */
export type CacheDeletionMetricReason = CacheDeletionReason | 'stale_upload';

export const cacheDeletionCount = meter.createCounter<{reason: CacheDeletionMetricReason}>(
  'cache_deletions',
  {description: 'Cache entries deleted by reason. A stale upload is one the reaper removed.'},
);

export const cacheSweepDuration = meter.createHistogram<{outcome: 'completed' | 'timed_out'}>(
  'cache_sweep_duration',
  {
    description: 'Duration of one cache sweep pass: expire, reap stale uploads, evict, prune',
    unit: 'ms',
    advice: {explicitBucketBoundaries: [100, 500, 1000, 5000, 15000, 60000, 180000, 480000]},
  },
);
