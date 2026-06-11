import type {StepResultDto} from '@shipfox/api-runners-dto';
import {issueJobLeaseToken} from '#core/job-lease-token.js';
import {claimPendingJob, expireStuckJob, finalizeRunningJob, findStuckJobs} from '#db/jobs.js';

export async function completeJob(
  params: {jobId: string; runnerTokenId: string},
  result: {status: 'succeeded' | 'failed'; steps: StepResultDto[]},
): Promise<{runId: string}> {
  return await finalizeRunningJob({
    jobId: params.jobId,
    runnerTokenId: params.runnerTokenId,
    status: result.status,
    steps: result.steps,
  });
}

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
    workspaceId: params.workspaceId,
    runnerTokenId: params.runnerTokenId,
  });

  return {jobId: claimed.jobId, runId: claimed.runId, leaseToken};
}

// N+1 by design (~1 SELECT + N DELETEs per tick). Bulk DELETE…RETURNING +
// multi-row outbox insert is the documented scale path; deferred until load
// signals demand it.
export async function detectAndExpireStuckJobs(params: {
  thresholdSeconds: number;
}): Promise<{expired: number}> {
  const candidates = await findStuckJobs({thresholdSeconds: params.thresholdSeconds});

  let expired = 0;
  for (const candidate of candidates) {
    const result = await expireStuckJob({
      jobId: candidate.jobId,
      staleBeforeMs: params.thresholdSeconds * 1000,
    });
    if (result) expired += 1;
  }
  return {expired};
}
