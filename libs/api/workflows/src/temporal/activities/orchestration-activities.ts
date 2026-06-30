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
  getJobExecutionsByWorkflowRunAttemptId,
  getJobsByWorkflowRunAttemptId,
  getWorkflowRunAttemptById,
  getWorkflowRunByAttemptId,
  getWorkflowRunById,
  listRunAttempts,
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
}

export interface RunDag {
  runId: string;
  runAttemptId: string;
  workspaceId: string;
  projectId: string;
  runVersion: number;
  jobs: DagJob[];
}

export async function loadRunAttemptDag(runAttemptId: string): Promise<RunDag> {
  const run = await getWorkflowRunByAttemptId(runAttemptId);
  if (!run) throw new Error(`Run not found for attempt: ${runAttemptId}`);
  const attempt = await getWorkflowRunAttemptById(runAttemptId);
  if (!attempt) throw new Error(`Run attempt not found: ${runAttemptId}`);

  const jobs = await getJobsByWorkflowRunAttemptId(runAttemptId);
  const jobExecutions = await getJobExecutionsByWorkflowRunAttemptId(runAttemptId);
  const firstJobExecutions = new Map<string, (typeof jobExecutions)[number]>();
  for (const jobExecution of jobExecutions) {
    if (!firstJobExecutions.has(jobExecution.jobId)) {
      firstJobExecutions.set(jobExecution.jobId, jobExecution);
    }
  }

  return {
    runId: run.id,
    runAttemptId,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    runVersion: attempt.version,
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
        },
      ];
    }),
  };
}

export async function loadRunDag(runId: string): Promise<RunDag> {
  const run = await getWorkflowRunById(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  const attempts = await listRunAttempts({workflowRunId: run.id, projectId: run.projectId});
  const attempt = attempts.find((candidate) => candidate.attempt === run.currentAttempt);
  if (!attempt) throw new Error(`Run attempt not found for run: ${runId}`);
  return loadRunAttemptDag(attempt.id);
}

export async function setRunAttemptStatus(params: {
  runAttemptId: string;
  status: WorkflowRunStatus;
  version: number;
}): Promise<{newVersion: number; status: WorkflowRunStatus}> {
  const updated = await updateWorkflowRunStatus({
    workflowRunAttemptId: params.runAttemptId,
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
  runAttemptId: string;
  projectId: string;
  requiredLabels: string[];
}): Promise<void> {
  try {
    await enqueueJobExecution({
      workspaceId: params.workspaceId,
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
      workflowRunAttemptId: params.runAttemptId,
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
  runAttemptId: string;
  expectedVersion: number;
}): Promise<{newVersion: number}> {
  const jobExecution = await failJobExecutionAsTimedOut({
    jobExecutionId: params.jobExecutionId,
    workflowRunAttemptId: params.runAttemptId,
    expectedVersion: params.expectedVersion,
  });
  return {newVersion: jobExecution.version};
}

export async function resolveJobStatusFromJobExecutionsActivity(params: {
  jobId: string;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  return await resolveJobStatusFromJobExecutions(params);
}
