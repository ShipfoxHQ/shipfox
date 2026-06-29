import {deleteExpiredRunnerReservations, detectAndExpireStuckJobs} from '#core/maintenance.js';

export function detectAndExpireStuckJobsActivity(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  return detectAndExpireStuckJobs(params);
}

export function deleteExpiredReservationsActivity(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  return deleteExpiredRunnerReservations(params);
}
