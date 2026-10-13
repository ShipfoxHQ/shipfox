import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {UsageModuleClient} from '@shipfox/api-usage-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {ShipfoxModule} from '@shipfox/node-module';
import {type CacheStoragePolicy, createWorkspaceStorageLimits} from '#core/storage-policy.js';
import {db} from '#db/db.js';
import {migrationsPath} from '#db/index.js';
import {registerCacheServiceMetrics} from '#metrics/service.js';
import {createCacheRoutes} from '#presentation/routes/index.js';
import {createCacheActivities} from '#temporal/activities/index.js';
import {
  CACHE_MAINTENANCE_TASK_QUEUE,
  CACHE_STORAGE_SAMPLER_CRON_ID,
  CACHE_STORAGE_SAMPLER_CRON_SCHEDULE,
} from '#temporal/constants.js';

export {checkBucketReachable} from '#api/object-storage.js';
export type {CacheStorageLimits, CacheStoragePolicy} from '#core/storage-policy.js';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowsPath = resolve(packageRoot, 'dist/temporal/workflows/index.js');

export interface CreateCacheModuleOptions {
  /** Without a policy, `CACHE_WORKSPACE_MAX_BYTES` bounds every workspace. */
  storage?: {policy: CacheStoragePolicy} | undefined;
}

export function createCacheModule({
  workflows,
  usage,
  storage,
}: CreateCacheModuleOptions & {
  workflows: WorkflowsModuleClient;
  usage: UsageModuleClient;
}): ShipfoxModule {
  // One instance, so the routes and the sweeper share the resolved limits.
  const limits = createWorkspaceStorageLimits(storage?.policy);

  return {
    name: 'cache',
    database: {db, migrationsPath, databaseNamespace: 'cache'},
    routes: createCacheRoutes(workflows, limits),
    metrics: registerCacheServiceMetrics,
    workers: [
      {
        taskQueue: CACHE_MAINTENANCE_TASK_QUEUE,
        workflowsPath,
        activities: () => createCacheActivities({limits, usage}),
        workflows: [
          {name: 'cacheSweepCron', id: 'cache-sweep', cronSchedule: '*/10 * * * *'},
          {
            name: 'cacheStorageSamplerCron',
            id: CACHE_STORAGE_SAMPLER_CRON_ID,
            cronSchedule: CACHE_STORAGE_SAMPLER_CRON_SCHEDULE,
          },
        ],
      },
    ],
  };
}
