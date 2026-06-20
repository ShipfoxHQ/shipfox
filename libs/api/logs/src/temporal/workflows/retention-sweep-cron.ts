import {log, proxyActivities} from '@temporalio/workflow';
import type {createLogsActivities} from '../activities/index.js';

const {retentionSweepActivity} = proxyActivities<ReturnType<typeof createLogsActivities>>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '1 minute',
  // The activity self-bounds on a wall-clock budget and is idempotent, so the next cron run is
  // the natural retry. Cap attempts at 1 so a heartbeat or timeout failure cannot start a retry
  // attempt that overlaps the original run's still-draining loop (a timeout does not kill it).
  retry: {maximumAttempts: 1},
});

export async function retentionSweepCron(): Promise<void> {
  const {deleted, raced, failed, accountingPruned, iterations, timedOut} =
    await retentionSweepActivity();
  // Always logged (not just on activity): a destructive sweep deserves a per-run record.
  log.info('Retention sweep complete', {
    deleted,
    raced,
    failed,
    accountingPruned,
    iterations,
    timedOut,
  });
}
