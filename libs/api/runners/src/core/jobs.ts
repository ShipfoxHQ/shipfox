import {issueJobLeaseToken} from '@shipfox/api-auth';
import {claimPendingJob, expireStuckJobs} from '#db/jobs.js';
import {jobClaimedCount} from '#metrics/instance.js';

export interface ClaimJobResult {
  jobId: string;
  runId: string;
  leaseToken: string;
}

export async function claimJob(params: {
  workspaceId: string;
  runnerSessionId: string;
  sessionLabels: string[];
  maxClaims: number | null;
}): Promise<ClaimJobResult | null> {
  const claimed = await claimPendingJob(params);
  if (!claimed) {
    jobClaimedCount.add(1, {outcome: 'empty'});
    return null;
  }
  jobClaimedCount.add(1, {outcome: 'claimed'});

  const leaseToken = await issueJobLeaseToken({
    jobId: claimed.jobId,
    runId: claimed.runId,
    projectId: claimed.projectId,
    workspaceId: params.workspaceId,
    runnerSessionId: params.runnerSessionId,
  });

  return {jobId: claimed.jobId, runId: claimed.runId, leaseToken};
}

export async function detectAndExpireStuckJobs(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  const reaped = await expireStuckJobs({thresholdSeconds: params.thresholdSeconds});
  return {expired: reaped.length};
}
