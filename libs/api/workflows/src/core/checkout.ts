import type {CheckoutSpec, IntegrationSourceControlService} from '@shipfox/api-integration-core';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
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
  persistCredentials: boolean;
  permissions: {contents: 'read' | 'write'};
}

/**
 * Resolves what to check out for a job, keyed off the authoritative `jobId`
 * (`workflowRunId`/`workflowRunAttemptId`/`workspaceId` in the lease claim are informational).
 * Chain: job → attempt → run → project source metadata. Credential-free.
 */
export async function resolveCheckoutIntent(
  jobId: string,
  projects: ProjectsModuleClient,
): Promise<CheckoutIntent> {
  const job = await getJobById(jobId);
  if (!job) throw new JobNotFoundError(jobId);

  const run = await getWorkflowRunByAttemptId(job.workflowRunAttemptId);
  if (!run) throw new WorkflowRunNotFoundError(job.workflowRunAttemptId);

  const {project} = await projects.getProjectById({projectId: run.projectId});
  if (project === null) throw new CheckoutIntentUnresolvedError(run.projectId);

  return {
    workspaceId: project.workspaceId,
    connectionId: project.sourceConnectionId,
    externalRepositoryId: project.sourceExternalRepositoryId,
    persistCredentials: job.checkout.persistCredentials,
    permissions: job.checkout.permissions,
  };
}

/**
 * Resolves the job's checkout intent and exchanges it for a short-lived,
 * scoped checkout spec. `ref` is left undefined so the provider defaults to the
 * repository's default branch.
 */
export async function createJobCheckoutSpec({
  jobId,
  sourceControl,
  projects,
}: {
  jobId: string;
  sourceControl: IntegrationSourceControlService;
  projects: ProjectsModuleClient;
}): Promise<{spec: CheckoutSpec; persistCredentials: boolean}> {
  const intent = await resolveCheckoutIntent(jobId, projects);
  const spec = await sourceControl.createCheckoutSpec({
    workspaceId: intent.workspaceId,
    connectionId: intent.connectionId,
    externalRepositoryId: intent.externalRepositoryId,
    ref: undefined,
    permissions: intent.permissions,
  });
  return {spec, persistCredentials: intent.persistCredentials};
}
