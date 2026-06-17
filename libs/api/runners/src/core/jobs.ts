import {issueJobLeaseToken} from '@shipfox/api-auth';
import {claimPendingJob, expireStuckJobs} from '#db/jobs.js';

export interface ClaimJobResult {
  jobId: string;
  runId: string;
  leaseToken: string;
}

export async function claimJob(params: {
  workspaceId: string;
  runnerTokenId: string;
}): Promise<ClaimJobResult | null> {
  const claimed = await claimPendingJob(params);
  if (!claimed) return null;

  const leaseToken = await issueJobLeaseToken({
    jobId: claimed.jobId,
    runId: claimed.runId,
    projectId: claimed.projectId,
    workspaceId: params.workspaceId,
    runnerTokenId: params.runnerTokenId,
  });

  return {jobId: claimed.jobId, runId: claimed.runId, leaseToken};
}

export async function detectAndExpireStuckJobs(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  const reaped = await expireStuckJobs({thresholdSeconds: params.thresholdSeconds});
  return {expired: reaped.length};
}
