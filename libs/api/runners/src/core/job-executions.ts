import {issueJobLeaseToken} from '@shipfox/api-auth';
import {claimPendingJobExecution} from '#db/job-executions.js';
import {jobExecutionClaimedCount} from '#metrics/instance.js';

export interface ClaimJobExecutionResult {
  jobId: string;
  executionId: string;
  runId: string;
  leaseToken: string;
}

export async function claimJobExecution(params: {
  workspaceId: string;
  runnerSessionId: string;
  sessionLabels: string[];
  maxClaims: number | null;
}): Promise<ClaimJobExecutionResult | null> {
  const claimed = await claimPendingJobExecution(params);
  if (!claimed) {
    jobExecutionClaimedCount.add(1, {outcome: 'empty'});
    return null;
  }
  jobExecutionClaimedCount.add(1, {outcome: 'claimed'});

  const leaseToken = await issueJobLeaseToken({
    jobId: claimed.jobId,
    executionId: claimed.executionId,
    runId: claimed.runId,
    projectId: claimed.projectId,
    workspaceId: params.workspaceId,
    runnerSessionId: params.runnerSessionId,
  });

  return {jobId: claimed.jobId, executionId: claimed.executionId, runId: claimed.runId, leaseToken};
}
