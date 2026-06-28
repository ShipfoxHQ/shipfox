import {detectAndExpireStuckJobs} from '#core/jobs.js';
import {deleteExpiredReservations} from '#db/reservations.js';

export async function detectAndExpireStuckJobsActivity(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  return await detectAndExpireStuckJobs(params);
}

export async function deleteExpiredReservationsActivity(params?: {
  limit?: number;
}): Promise<{deleted: number}> {
  const deleted = await deleteExpiredReservations(params);
  return {deleted};
}
