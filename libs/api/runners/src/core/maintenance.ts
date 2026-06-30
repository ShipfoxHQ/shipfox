import {expireStuckJobs} from '#db/jobs.js';
import {deleteExpiredReservations} from '#db/reservations.js';
import {STUCK_JOB_THRESHOLD_SECONDS} from './maintenance-policy.js';

export interface DetectAndExpireStuckJobsParams {
  thresholdSeconds?: number;
}

export async function detectAndExpireStuckJobs(
  params: DetectAndExpireStuckJobsParams = {},
): Promise<{expired: number}> {
  const reaped = await expireStuckJobs({
    thresholdSeconds: params.thresholdSeconds ?? STUCK_JOB_THRESHOLD_SECONDS,
  });
  return {expired: reaped.length};
}

export async function deleteExpiredRunnerReservations(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  const deleted = await deleteExpiredReservations(params);
  return {deleted};
}
