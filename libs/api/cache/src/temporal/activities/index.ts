import type {WorkspaceStorageLimits} from '#core/storage-policy.js';
import {createCacheSweepActivity} from './cache-sweep.js';

export function createCacheActivities(deps: {limits: WorkspaceStorageLimits}) {
  return {cacheSweepActivity: createCacheSweepActivity(deps)};
}
