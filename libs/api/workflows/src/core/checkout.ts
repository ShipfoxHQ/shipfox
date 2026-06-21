import type {CheckoutSpec, IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {getProjectById} from '@shipfox/api-projects';
import {getJobById, getWorkflowRunById} from '#db/workflow-runs.js';
import type {JobStatus} from './entities/job.js';
import {
  CheckoutIntentUnresolvedError,
  JobNotActiveError,
  JobNotFoundError,
  WorkflowRunNotFoundError,
} from './errors.js';

// A job may exchange its lease for checkout credentials only while it is
// actively running. Gating on a positive allowlist (rather than a terminal
// denylist) fails closed: a job that is still pending or already finished mints
// nothing, and any future non-terminal status cannot silently slip through.
const ACTIVE_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(['running']);

export interface CheckoutIntent {
  workspaceId: string;
  connectionId: string;
  externalRepositoryId: string;
}

/**
 * Resolves what to check out for a job, keyed off the authoritative `jobId`
 * (the only DB-trusted lease claim — `runId`/`workspaceId` are informational).
 * Chain: job → job.runId → run → project source metadata. Credential-free.
 */
export async function resolveCheckoutIntent(jobId: string): Promise<CheckoutIntent> {
  const job = await getJobById(jobId);
  if (!job) throw new JobNotFoundError(jobId);
  if (!ACTIVE_JOB_STATUSES.has(job.status)) throw new JobNotActiveError(jobId, job.status);

  // job.runId is a NOT NULL FK to workflow_runs, so the run effectively always
  // exists; the guard stays only to keep the resolution total.
  const run = await getWorkflowRunById(job.runId);
  if (!run) throw new WorkflowRunNotFoundError(job.runId);

  const project = await getProjectById(run.projectId);
  if (!project) throw new CheckoutIntentUnresolvedError(run.projectId);

  return {
    workspaceId: project.workspaceId,
    connectionId: project.sourceConnectionId,
    externalRepositoryId: project.sourceExternalRepositoryId,
  };
}

/**
 * Resolves the job's checkout intent and exchanges it for a short-lived,
 * read-only checkout spec. `ref` is left undefined so the provider defaults to
 * the repository's default branch.
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
  });
}
