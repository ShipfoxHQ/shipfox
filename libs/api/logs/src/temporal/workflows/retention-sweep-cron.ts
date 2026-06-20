import {log, proxyActivities} from '@temporalio/workflow';
import type {createLogsActivities} from '../activities/index.js';

const {retentionSweepActivity} = proxyActivities<ReturnType<typeof createLogsActivities>>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '1 minute',
  // Retry on the next cron tick so a timed-out attempt cannot overlap its own still-running loop.
  retry: {maximumAttempts: 1},
});

export async function retentionSweepCron(): Promise<void> {
  const {deleted, raced, failed, accountingPruned, iterations, timedOut} =
    await retentionSweepActivity();
  // Keep a workflow-level audit trail for this destructive sweep.
  log.info('Retention sweep complete', {
    deleted,
    raced,
    failed,
    accountingPruned,
    iterations,
    timedOut,
  });
}
