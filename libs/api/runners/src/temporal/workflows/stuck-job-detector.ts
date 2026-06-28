import {log, proxyActivities} from '@temporalio/workflow';

import type {createRunnersMaintenanceActivities} from '../activities/index.js';

const {deleteExpiredReservationsActivity, detectAndExpireStuckJobsActivity} = proxyActivities<
  ReturnType<typeof createRunnersMaintenanceActivities>
>({
  startToCloseTimeout: '60s',
});

const STUCK_JOB_THRESHOLD_SECONDS = 180;

export async function stuckJobDetector(): Promise<void> {
  const {deleted} = await deleteExpiredReservationsActivity();
  if (deleted > 0) {
    log.info('Stuck-job detector deleted expired runner reservations', {deleted});
  }

  const {expired} = await detectAndExpireStuckJobsActivity({
    thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
  });
  if (expired > 0) {
    log.info('Stuck-job detector expired job leases', {
      expired,
      thresholdSeconds: STUCK_JOB_THRESHOLD_SECONDS,
    });
  }
}
