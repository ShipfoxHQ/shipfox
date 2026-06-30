import {issueJobLeaseToken} from '@shipfox/api-auth';
import {claimPendingJobExecution} from '#db/job-executions.js';
import {jobExecutionClaimedCount} from '#metrics/instance.js';

export interface ClaimJobExecutionResult {
  jobId: string;
  jobExecutionId: string;
  workflowRunAttemptId: string;
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
    jobExecutionId: claimed.jobExecutionId,
    workflowRunAttemptId: claimed.workflowRunAttemptId,
    projectId: claimed.projectId,
    workspaceId: params.workspaceId,
    runnerSessionId: params.runnerSessionId,
  });

  return {
    jobId: claimed.jobId,
    jobExecutionId: claimed.jobExecutionId,
    workflowRunAttemptId: claimed.workflowRunAttemptId,
    leaseToken,
  };
}
