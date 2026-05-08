import {detectAndFailStuckJobs} from '#core/jobs.js';

export async function detectAndFailStuckJobsActivity(params: {
  thresholdSeconds: number;
}): Promise<{failed: number}> {
  return await detectAndFailStuckJobs(params);
}
