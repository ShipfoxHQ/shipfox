import {instanceMetrics} from '@shipfox/node-opentelemetry';

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
