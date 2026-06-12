import {issueJobLeaseToken} from '@shipfox/api-auth';
import {claimPendingJob, expireStuckJob, findStuckJobs} from '#db/jobs.js';

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

// N+1 by design (~1 SELECT + N DELETEs per tick): each candidate gets its own
// guarded DELETE so a heartbeat landing mid-tick spares the live row, and its
// outbox event commits in isolation. Chosen for simplicity over a bulk
// DELETE…RETURNING + multi-row outbox insert at the current low tick volume.
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
