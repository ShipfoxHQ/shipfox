import type {
  CheckoutPermissions,
  CheckoutSpec,
  IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import {getProjectById} from '@shipfox/api-projects';
import {getJobById, getWorkflowRunByAttemptId} from '#db/workflow-runs.js';
import {
  CheckoutIntentUnresolvedError,
  JobNotFoundError,
  WorkflowRunNotFoundError,
} from './errors.js';

export interface CheckoutIntent {
  workspaceId: string;
  connectionId: string;
  externalRepositoryId: string;
  permissions: CheckoutPermissions;
}

/**
 * Resolves what to check out for a job, keyed off the authoritative `jobId`
 * (`workflowRunId`/`workflowRunAttemptId`/`workspaceId` in the lease claim are informational).
 * Chain: job → attempt → run → project source metadata. Credential-free; the
 * returned intent carries only the job's requested checkout permission level.
 */
export async function resolveCheckoutIntent(jobId: string): Promise<CheckoutIntent> {
  const job = await getJobById(jobId);
  if (!job) throw new JobNotFoundError(jobId);

  const run = await getWorkflowRunByAttemptId(job.workflowRunAttemptId);
  if (!run) throw new WorkflowRunNotFoundError(job.workflowRunAttemptId);

  const project = await getProjectById(run.projectId);
  if (!project) throw new CheckoutIntentUnresolvedError(run.projectId);

  return {
    workspaceId: project.workspaceId,
    connectionId: project.sourceConnectionId,
    externalRepositoryId: project.sourceExternalRepositoryId,
    permissions: job.checkout?.permissions ?? {contents: 'read'},
  };
}

/**
 * Resolves the job's checkout intent and exchanges it for a provider checkout
 * spec. `ref` is left undefined so the provider defaults to the repository's
 * default branch.
 */
export async function createJobCheckoutSpec({
  jobId,
  sourceControl,
}: {
  jobId: string;
  sourceControl: IntegrationSourceControlService;
}): Promise<CheckoutSpec> {
  const intent = await resolveCheckoutIntent(jobId);
  return sourceControl.createCheckoutSpec({
    workspaceId: intent.workspaceId,
    connectionId: intent.connectionId,
    externalRepositoryId: intent.externalRepositoryId,
    ref: undefined,
    permissions: intent.permissions,
  });
}
