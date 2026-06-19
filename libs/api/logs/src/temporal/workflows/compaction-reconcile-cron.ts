import {log, proxyActivities} from '@temporalio/workflow';
import type {createLogsActivities} from '../activities/index.js';

const {compactionReconcileActivity} = proxyActivities<ReturnType<typeof createLogsActivities>>({
  startToCloseTimeout: '5 minutes',
});

/** Cron-scheduled backstop that re-drives closed streams whose compaction never started or permanently failed. */
export async function compactionReconcileCron(): Promise<void> {
  const {restarted} = await compactionReconcileActivity();
  if (restarted > 0) {
    log.info('Re-drove stale uncompacted log streams', {restarted});
  }
}
