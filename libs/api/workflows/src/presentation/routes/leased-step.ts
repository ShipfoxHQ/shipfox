import {type LeasedJobContext, requireLeasedJobContext} from '@shipfox/api-auth-context';
import {isJobLeaseActive} from '@shipfox/api-runners';
import {ClientError} from '@shipfox/node-fastify';
import type {Step} from '#core/entities/step.js';
import {getJobScope, getStepByIdForJobExecution} from '#db/index.js';

export interface LoadedRunningLeasedStep {
  leasedJob: LeasedJobContext;
  step: Step;
  workspaceId: string;
  projectId: string;
}

export async function loadRunningLeasedStep(params: {
  request: object;
  stepId: string;
  attempt: number;
}): Promise<LoadedRunningLeasedStep> {
  const leasedJob = requireLeasedJobContext(params.request);

  const leaseIsActive = await isJobLeaseActive({
    jobId: leasedJob.jobId,
    jobExecutionId: leasedJob.jobExecutionId,
    runnerSessionId: leasedJob.runnerSessionId,
  });
  if (!leaseIsActive) {
    throw new ClientError('Job lease is no longer active', 'lease-not-active', {status: 404});
  }

  const step = await getStepByIdForJobExecution({
    stepId: params.stepId,
    jobExecutionId: leasedJob.jobExecutionId,
  });
  if (!step) {
    throw new ClientError('Step not found for leased job', 'step-not-found', {status: 404});
  }

  const scope = await getJobScope(leasedJob.jobId);
  if (!scope) {
    throw new ClientError('Leased job not found', 'job-not-found', {status: 404});
  }

  if (step.currentAttempt !== params.attempt) {
    throw new ClientError('Step attempt does not match current attempt', 'step-attempt-mismatch', {
      status: 409,
    });
  }

  if (step.status !== 'running') {
    throw new ClientError('Step is not running', 'step-not-running', {status: 409});
  }

  return {leasedJob, step, workspaceId: scope.workspaceId, projectId: scope.projectId};
}
