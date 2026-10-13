import {log, proxyActivities} from '@temporalio/workflow';
import type {createCacheActivities} from '../activities/index.js';

const {cacheSweepActivity} = proxyActivities<ReturnType<typeof createCacheActivities>>({
  startToCloseTimeout: '9 minutes',
  heartbeatTimeout: '1 minute',
  // Retry on the next cron tick so a timed-out attempt cannot overlap its own still-running loop.
  retry: {maximumAttempts: 1},
});

export async function cacheSweepCron(): Promise<void> {
  const {expired, reaped, evicted, failed, deletionRecordsPruned, timedOut} =
    await cacheSweepActivity();
  // Keep a workflow-level audit trail for this destructive sweep.
  log.info('Cache sweep complete', {
    expired,
    reaped,
    evicted,
    failed,
    deletionRecordsPruned,
    timedOut,
  });
}
