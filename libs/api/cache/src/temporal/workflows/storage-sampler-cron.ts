import {log, proxyActivities} from '@temporalio/workflow';
import type {createCacheActivities} from '../activities/index.js';

// A retry in the same hour is a duplicate in Usage, so the activity can be retried freely.
const {recordStorageSamplesActivity} = proxyActivities<ReturnType<typeof createCacheActivities>>({
  startToCloseTimeout: '5 minutes',
  retry: {maximumAttempts: 3},
});

export async function cacheStorageSamplerCron(): Promise<void> {
  const result = await recordStorageSamplesActivity();
  log.info('Cache storage samples recorded', {...result});
}
