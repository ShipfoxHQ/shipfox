import {log, proxyActivities} from '@temporalio/workflow';

import type {createRunnersMaintenanceActivities} from '../activities/index.js';

const {detectAndFailStuckJobsActivity} = proxyActivities<
  ReturnType<typeof createRunnersMaintenanceActivities>
>({
  startToCloseTimeout: '60s',
});

const STUCK_JOB_THRESHOLD_SECONDS = 180;

export async function stuckJobDetector(): Promise<void> {
  const {failed} = await detectAndFailStuckJobsActivity({
    thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
  });
  if (failed > 0) {
    log.info('Stuck-job detector failed jobs', {
      failed,
      thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
    });
  }
}
