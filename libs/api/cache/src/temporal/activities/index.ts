import type {UsageModuleClient} from '@shipfox/api-usage-dto/inter-module';
import type {WorkspaceStorageLimits} from '#core/storage-policy.js';
import {createCacheSweepActivity} from './cache-sweep.js';
import {createRecordStorageSamplesActivity} from './record-storage-samples.js';

export function createCacheActivities(deps: {
  limits: WorkspaceStorageLimits;
  usage: UsageModuleClient;
}) {
  return {
    cacheSweepActivity: createCacheSweepActivity(deps),
    recordStorageSamplesActivity: createRecordStorageSamplesActivity(deps),
  };
}
