import {cancelRunnerJobs, enqueueJobExecution, releaseJobExecution} from '@shipfox/api-runners';
import {ApplicationFailure} from '@temporalio/common';
import type {JobStatus, JobStatusReason} from '#core/entities/job.js';
import type {RuntimeCompletionStatus, RuntimeDagJob} from '#core/entities/runtime-dag.js';
import type {StepStatus} from '#core/entities/step.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {JobNotFoundError} from '#core/errors.js';
import {
  bulkUpdateStepStatuses,
  failJobExecutionAsTimedOut,
  getJobExecutionsByRunId,
  getJobsByRunId,
  getStepsByJobExecutionIds,
  getWorkflowRunById,
  resolveJobExecutionAfterLeaseExpiry,
  resolveJobStatusFromJobExecutions,
  updateJobExecutionStatus,
  updateJobStatus,
  updateWorkflowRunStatus,
} from '#db/index.js';

export interface DagJob extends RuntimeDagJob {
  id: string;
  name: string;
  status: JobStatus;
  jobExecutionId: string;
  executionVersion?: number;
  executionTimeoutMs?: number | null | undefined;
  dependencies: string[];
  runner: string[];
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
  const jobExecutions = await getJobExecutionsByRunId(runId);
  const firstJobExecutions = new Map<string, (typeof jobExecutions)[number]>();
  for (const jobExecution of jobExecutions) {
    if (!firstJobExecutions.has(jobExecution.jobId)) {
      firstJobExecutions.set(jobExecution.jobId, jobExecution);
    }
  }
  const jobExecutionIds = [...firstJobExecutions.values()].map((jobExecution) => jobExecution.id);
  const allSteps = await getStepsByJobExecutionIds(jobExecutionIds);

  const stepsByJobExecutionId = new Map<string, typeof allSteps>();
  for (const step of allSteps) {
    const arr = stepsByJobExecutionId.get(step.jobExecutionId) ?? [];
    arr.push(step);
    stepsByJobExecutionId.set(step.jobExecutionId, arr);
  }

  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    runVersion: run.version,
    jobs: jobs.flatMap((job) => {
      const jobExecution = firstJobExecutions.get(job.id);
      if (!jobExecution) return [];
      return [
        {
          id: job.id,
          name: job.name,
          status: job.status,
          jobExecutionId: jobExecution.id,
          executionVersion: jobExecution.version,
          executionTimeoutMs: job.executionTimeoutMs,
          dependencies: job.dependencies,
          runner: job.runner ?? [],
          version: job.version,
          steps: (stepsByJobExecutionId.get(jobExecution.id) ?? []).map((s) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            config: s.config,
            position: s.position,
          })),
        },
      ];
    }),
  };
}

export async function setRunStatus(params: {
  runId: string;
  status: WorkflowRunStatus;
  version: number;
}): Promise<{newVersion: number; status: WorkflowRunStatus}> {
  const updated = await updateWorkflowRunStatus({
    runId: params.runId,
    status: params.status,
    expectedVersion: params.version,
  });
  return {newVersion: updated.version, status: updated.status};
}

export async function setJobStatus(params: {
  jobId: string;
  status: JobStatus;
  version: number;
  statusReason?: JobStatusReason | null | undefined;
}): Promise<{newVersion: number; status: JobStatus}> {
  const updated = await updateJobStatus({
    jobId: params.jobId,
    status: params.status,
    expectedVersion: params.version,
    statusReason: params.statusReason,
  });
  return {newVersion: updated.version, status: updated.status};
}

export async function setJobExecutionStatus(params: {
  jobExecutionId: string;
  status: Exclude<JobStatus, 'skipped'>;
  version: number;
  statusReason?: JobStatusReason | null | undefined;
}): Promise<{newVersion: number; status: Exclude<JobStatus, 'skipped'>}> {
  const updated = await updateJobExecutionStatus({
    jobExecutionId: params.jobExecutionId,
    status: params.status,
    expectedVersion: params.version,
    statusReason: params.statusReason,
  });
  return {newVersion: updated.version, status: updated.status};
}

export async function bulkSetStepStatuses(params: {
  jobExecutionId: string;
  status: StepStatus;
}): Promise<void> {
  await bulkUpdateStepStatuses(params);
}

export async function resolveLeaseExpiredJobExecutionActivity(params: {
  jobExecutionId: string;
  expectedVersion: number;
}): Promise<{status: RuntimeCompletionStatus; executionVersion: number}> {
  try {
    return await resolveJobExecutionAfterLeaseExpiry(params);
  } catch (err) {
    if (err instanceof JobNotFoundError) {
      throw ApplicationFailure.nonRetryable(err.message, err.name);
    }
    throw err;
  }
}

// Best-effort lease cleanup on job finalization. Idempotent: deleting an
// already-released (or already-reaped) lease is a no-op. The workflow wraps the
// call so a persistent failure never blocks the DAG result.
export async function releaseLeaseActivity(params: {jobExecutionId: string}): Promise<void> {
  await releaseJobExecution({jobExecutionId: params.jobExecutionId});
}

export async function enqueueJobExecutionForRunner(params: {
  workspaceId: string;
  jobId: string;
  jobExecutionId: string;
  runId: string;
  projectId: string;
  requiredLabels: string[];
}): Promise<void> {
  try {
    await enqueueJobExecution({
      workspaceId: params.workspaceId,
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      runId: params.runId,
      projectId: params.projectId,
      requiredLabels: params.requiredLabels,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'EmptyRequiredLabelsError') {
      throw ApplicationFailure.nonRetryable(err.message, err.name);
    }
    throw err;
  }
}

export async function cancelRunnerJobsActivity(params: {jobIds: string[]}): Promise<void> {
  await cancelRunnerJobs({jobIds: params.jobIds});
}

export async function failJobExecutionAsTimedOutActivity(params: {
  jobExecutionId: string;
  runId: string;
  expectedVersion: number;
}): Promise<{newVersion: number}> {
  const jobExecution = await failJobExecutionAsTimedOut(params);
  return {newVersion: jobExecution.version};
}

export async function resolveJobStatusFromJobExecutionsActivity(params: {
  jobId: string;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  return await resolveJobStatusFromJobExecutions(params);
}
