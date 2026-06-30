import {cancelRunnerJobs, enqueueJob, releaseJob} from '@shipfox/api-runners';
import {ApplicationFailure} from '@temporalio/common';
import type {JobStatus, JobStatusReason} from '#core/entities/job.js';
import type {RuntimeCompletionStatus, RuntimeDagJob} from '#core/entities/runtime-dag.js';
import type {StepStatus} from '#core/entities/step.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {JobNotFoundError} from '#core/errors.js';
import {
  bulkUpdateStepStatuses,
  failExecutionAsTimedOut,
  getExecutionsByJobId,
  getJobsByRunId,
  getStepsByExecutionIds,
  getWorkflowRunById,
  resolveExecutionAfterLeaseExpiry,
  resolveJobStatusFromExecutions,
  updateExecutionStatus,
  updateJobStatus,
  updateWorkflowRunStatus,
} from '#db/index.js';

export interface DagJob extends RuntimeDagJob {
  id: string;
  name: string;
  status: JobStatus;
  executionId: string;
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
  const executions = await Promise.all(jobs.map((job) => getExecutionsByJobId(job.id)));
  const firstExecutions = new Map(
    executions.flatMap((rows) => (rows[0] ? [[rows[0].jobId, rows[0]]] : [])),
  );
  const executionIds = [...firstExecutions.values()].map((execution) => execution.id);
  const allSteps = await getStepsByExecutionIds(executionIds);

  const stepsByExecutionId = new Map<string, typeof allSteps>();
  for (const step of allSteps) {
    const arr = stepsByExecutionId.get(step.executionId) ?? [];
    arr.push(step);
    stepsByExecutionId.set(step.executionId, arr);
  }

  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    runVersion: run.version,
    jobs: jobs.flatMap((job) => {
      const execution = firstExecutions.get(job.id);
      if (!execution) return [];
      return [
        {
          id: job.id,
          name: job.name,
          status: job.status,
          executionId: execution.id,
          executionVersion: execution.version,
          executionTimeoutMs: job.executionTimeoutMs,
          dependencies: job.dependencies,
          runner: job.runner ?? [],
          version: job.version,
          steps: (stepsByExecutionId.get(execution.id) ?? []).map((s) => ({
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

export async function setExecutionStatus(params: {
  executionId: string;
  status: Exclude<JobStatus, 'skipped'>;
  version: number;
  statusReason?: JobStatusReason | null | undefined;
}): Promise<{newVersion: number; status: Exclude<JobStatus, 'skipped'>}> {
  const updated = await updateExecutionStatus({
    executionId: params.executionId,
    status: params.status,
    expectedVersion: params.version,
    statusReason: params.statusReason,
  });
  return {newVersion: updated.version, status: updated.status};
}

export async function bulkSetStepStatuses(params: {
  executionId: string;
  status: StepStatus;
}): Promise<void> {
  await bulkUpdateStepStatuses(params);
}

export async function resolveLeaseExpiredExecutionActivity(params: {
  executionId: string;
  expectedVersion: number;
}): Promise<{status: RuntimeCompletionStatus; executionVersion: number}> {
  try {
    return await resolveExecutionAfterLeaseExpiry(params);
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
export async function releaseLeaseActivity(params: {executionId: string}): Promise<void> {
  await releaseJob({executionId: params.executionId});
}

export async function enqueueJobForRunner(params: {
  workspaceId: string;
  jobId: string;
  executionId: string;
  runId: string;
  projectId: string;
  requiredLabels: string[];
}): Promise<void> {
  try {
    await enqueueJob({
      workspaceId: params.workspaceId,
      jobId: params.jobId,
      executionId: params.executionId,
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

export async function failExecutionAsTimedOutActivity(params: {
  executionId: string;
  runId: string;
  expectedVersion: number;
}): Promise<{newVersion: number}> {
  const execution = await failExecutionAsTimedOut(params);
  return {newVersion: execution.version};
}

export async function resolveJobStatusFromExecutionsActivity(params: {
  jobId: string;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  return await resolveJobStatusFromExecutions(params);
}
