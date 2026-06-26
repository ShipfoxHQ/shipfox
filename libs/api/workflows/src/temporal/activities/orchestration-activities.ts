import {enqueueJob, releaseJob} from '@shipfox/api-runners';
import {ApplicationFailure} from '@temporalio/common';
import type {JobStatus, JobStatusReason} from '#core/entities/job.js';
import type {RuntimeCompletionStatus, RuntimeDagJob} from '#core/entities/runtime-dag.js';
import type {StepStatus} from '#core/entities/step.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {JobNotFoundError} from '#core/errors.js';
import {
  bulkUpdateStepStatuses,
  failJobAsTimedOut,
  getJobsByRunId,
  getStepsByJobIds,
  getWorkflowRunById,
  resolveJobAfterLeaseExpiry,
  updateJobStatus,
  updateWorkflowRunStatus,
} from '#db/index.js';

export interface DagJob extends RuntimeDagJob {
  id: string;
  name: string;
  status: string;
  dependencies: string[];
  version: number;
  steps: Array<{
    id: string;
    name: string | null;
    type: string;
    config: Record<string, unknown>;
    position: number;
  }>;
}

export interface RunDag {
  runId: string;
  workspaceId: string;
  projectId: string;
  runVersion: number;
  jobs: DagJob[];
}

export async function loadRunDag(runId: string): Promise<RunDag> {
  const run = await getWorkflowRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);

  const jobs = await getJobsByRunId(runId);
  const jobIds = jobs.map((j) => j.id);
  const allSteps = await getStepsByJobIds(jobIds);

  const stepsByJobId = new Map<string, typeof allSteps>();
  for (const step of allSteps) {
    const arr = stepsByJobId.get(step.jobId) ?? [];
    arr.push(step);
    stepsByJobId.set(step.jobId, arr);
  }

  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    runVersion: run.version,
    jobs: jobs.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      dependencies: job.dependencies,
      version: job.version,
      steps: (stepsByJobId.get(job.id) ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        config: s.config,
        position: s.position,
      })),
    })),
  };
}

export async function setRunStatus(params: {
  runId: string;
  status: WorkflowRunStatus;
  version: number;
}): Promise<{newVersion: number}> {
  const updated = await updateWorkflowRunStatus({
    runId: params.runId,
    status: params.status,
    expectedVersion: params.version,
  });
  return {newVersion: updated.version};
}

export async function setJobStatus(params: {
  jobId: string;
  status: JobStatus;
  version: number;
  statusReason?: JobStatusReason | null | undefined;
}): Promise<{newVersion: number}> {
  const updated = await updateJobStatus({
    jobId: params.jobId,
    status: params.status,
    expectedVersion: params.version,
    statusReason: params.statusReason,
  });
  return {newVersion: updated.version};
}

export async function bulkSetStepStatuses(params: {
  jobId: string;
  status: StepStatus;
}): Promise<void> {
  await bulkUpdateStepStatuses(params);
}

// Lease-expiry resolution is a single guarded DB transaction (server state is the
// final gate); the activity is a thin pass-through that returns the job's actual
// persisted terminal status so the workflow hands run-orchestration the truth.
export async function resolveLeaseExpiredJobActivity(params: {
  jobId: string;
  expectedVersion: number;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  try {
    return await resolveJobAfterLeaseExpiry(params);
  } catch (err) {
    // A job with no steps is a data-integrity bug, not a transient fault. Retrying
    // it would loop until the workflow's 60-min backstop; surface it immediately
    // as a non-retryable failure instead.
    if (err instanceof JobNotFoundError) {
      throw ApplicationFailure.nonRetryable(err.message, err.name);
    }
    throw err;
  }
}

// Best-effort lease cleanup on job finalization. Idempotent: deleting an
// already-released (or already-reaped) lease is a no-op. The workflow wraps the
// call so a persistent failure never blocks the DAG result.
export async function releaseLeaseActivity(params: {jobId: string}): Promise<void> {
  await releaseJob({jobId: params.jobId});
}

export async function enqueueJobForRunner(params: {
  workspaceId: string;
  jobId: string;
  runId: string;
  projectId: string;
}): Promise<void> {
  await enqueueJob({
    workspaceId: params.workspaceId,
    jobId: params.jobId,
    runId: params.runId,
    projectId: params.projectId,
  });
}

export async function failJobAsTimedOutActivity(params: {
  jobId: string;
  runId: string;
  expectedVersion: number;
}): Promise<{newVersion: number}> {
  const job = await failJobAsTimedOut(params);
  return {newVersion: job.version};
}
