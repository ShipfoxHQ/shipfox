import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {claimPendingJobExecution} from '#db/job-executions.js';
import {jobExecutionClaimedCount} from '#metrics/instance.js';
import {config} from '../config.js';

export interface ClaimJobExecutionResult {
  workflowRunId: string;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  leaseToken: string;
}

export async function claimJobExecution(params: {
  auth: AuthInterModuleClient;
  workspaceId: string;
  runnerSessionId: string;
  sessionLabels: string[];
  maxClaims: number | null;
}): Promise<ClaimJobExecutionResult | null> {
  const claimed = await claimPendingJobExecution({
    ...params,
    runnerSessionLivenessThrottleSeconds: config.RUNNER_SESSION_LIVENESS_THROTTLE_SECONDS,
  });
  if (!claimed) {
    jobExecutionClaimedCount.add(1, {outcome: 'empty'});
    return null;
  }
  jobExecutionClaimedCount.add(1, {outcome: 'claimed'});

  const {token: leaseToken} = await params.auth.mintJobLeaseToken({
    workflowRunId: claimed.workflowRunId,
    workflowRunAttemptId: claimed.workflowRunAttemptId,
    jobId: claimed.jobId,
    jobExecutionId: claimed.jobExecutionId,
    projectId: claimed.projectId,
    workspaceId: params.workspaceId,
    runnerSessionId: params.runnerSessionId,
  });

  return {
    workflowRunId: claimed.workflowRunId,
    workflowRunAttemptId: claimed.workflowRunAttemptId,
    jobId: claimed.jobId,
    jobExecutionId: claimed.jobExecutionId,
    leaseToken,
  };
}
