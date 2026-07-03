import {
  deleteExpiredRunnerReservations,
  detectAndExpireStuckJobs,
  reapStaleProvisionedRunners,
} from '#core/maintenance.js';

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

export function reapStaleProvisionedRunnersActivity(params?: {
  thresholdSeconds: number;
  limit: number;
}): Promise<{reaped: number; reservationsReleased: number}> {
  return reapStaleProvisionedRunners(params);
}
