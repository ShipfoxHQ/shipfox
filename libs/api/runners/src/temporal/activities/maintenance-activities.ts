import {deleteExpiredRunnerReservations, detectAndExpireStuckJobs} from '#core/maintenance.js';

export async function detectAndExpireStuckJobsActivity(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  return await detectAndExpireStuckJobs(params);
}

export async function deleteExpiredReservationsActivity(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  return await deleteExpiredRunnerReservations(params);
}
