import {detectAndExpireStuckJobs} from '#core/jobs.js';

export async function detectAndExpireStuckJobsActivity(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  return await detectAndExpireStuckJobs(params);
}
