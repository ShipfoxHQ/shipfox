import {cancelRunnerJobs, enqueueJobExecution, releaseJobExecution} from '@shipfox/api-runners';
import {ApplicationFailure} from '@temporalio/common';
import type {JobStatus, JobStatusReason, ResolutionReason} from '#core/entities/job.js';
import type {StepStatus} from '#core/entities/step.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';
import {JobNotFoundError} from '#core/errors.js';
import type {
  RuntimeCompletionStatus,
  RuntimeDagNode,
} from '#core/workflow-scheduling/runtime-dag.js';
import {
  activateJobListener,
  bulkUpdateStepStatuses,
  drainListenerEventsIntoExecution,
  failJobExecutionAsTimedOut,
  failWorkflowRunAsTimedOut,
  getJobExecutionsByWorkflowRunAttemptId,
  getJobsByWorkflowRunAttemptId,
  getWorkflowRunAttemptById,
  getWorkflowRunByAttemptId,
  peekListenerBuffer,
  resolveJobExecutionAfterLeaseExpiry,
  resolveJobListener,
  resolveJobStatusFromJobExecutions,
  settleListenerJobExecution,
  updateJobExecutionStatus,
  updateJobStatus,
  updateWorkflowRunStatus,
} from '#db/index.js';
import {recordWorkflowListenerExecution} from '#metrics/instance.js';

export interface DagJob extends RuntimeDagNode {
  id: string;
  key: string;
  mode: 'one_shot' | 'listening';
  status: JobStatus;
  jobExecutionId?: string | undefined;
  executionVersion?: number;
  executionTimeoutMs?: number | null | undefined;
  listeningTimeoutMs?: number | null | undefined;
  maxExecutions?: number | null | undefined;
  onResolve?: 'finish' | 'cancel' | null | undefined;
  batchDebounceMs?: number | null | undefined;
  batchMaxSize?: number | null | undefined;
  batchMaxWaitMs?: number | null | undefined;
  dependencies: string[];
  runner: string[];
  version: number;
}

export interface RunDag {
  workflowRunId: string;
  runAttemptId: string;
  workspaceId: string;
  projectId: string;
  runVersion: number;
  runTimeoutMs: number;
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
    workflowRunId: run.id,
    runAttemptId,
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    runVersion: attempt.version,
    runTimeoutMs: run.timeoutMs,
    jobs: jobs.flatMap((job) => {
      const jobExecution = firstJobExecutions.get(job.id);
      if (!jobExecution && job.mode !== 'listening') return [];
      return [
        {
          id: job.id,
          key: job.key,
          mode: job.mode,
          status: job.status,
          ...(jobExecution === undefined
            ? {}
            : {jobExecutionId: jobExecution.id, executionVersion: jobExecution.version}),
          executionTimeoutMs: job.executionTimeoutMs,
          listeningTimeoutMs: job.listeningTimeoutMs,
          maxExecutions: job.maxExecutions,
          onResolve: job.onResolve,
          batchDebounceMs: job.batchDebounceMs,
          batchMaxSize: job.batchMaxSize,
          batchMaxWaitMs: job.batchMaxWaitMs,
          dependencies: job.dependencies,
          runner: jobExecution?.runner ?? job.runner ?? [],
          version: job.version,
        },
      ];
    }),
  };
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
  workflowRunId: string;
  jobId: string;
  jobExecutionId: string;
  runAttemptId: string;
  projectId: string;
  requiredLabels: string[];
}): Promise<void> {
  try {
    await enqueueJobExecution({
      workspaceId: params.workspaceId,
      workflowRunId: params.workflowRunId,
      workflowRunAttemptId: params.runAttemptId,
      jobId: params.jobId,
      jobExecutionId: params.jobExecutionId,
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

export async function failRunAsTimedOutActivity(params: {runAttemptId: string}): Promise<void> {
  await failWorkflowRunAsTimedOut({runAttemptId: params.runAttemptId});
}

export async function resolveJobStatusFromJobExecutionsActivity(params: {
  jobId: string;
}): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  return await resolveJobStatusFromJobExecutions(params);
}

export async function activateJobListenerActivity(params: {
  jobId: string;
  expectedVersion: number;
}) {
  return await activateJobListener(params);
}

export async function drainListenerEventsActivity(params: {
  jobId: string;
  expectedSequence: number;
  maxSize?: number | undefined;
}) {
  return await drainListenerEventsIntoExecution(params);
}

export async function peekListenerBufferActivity(params: {jobId: string}) {
  return await peekListenerBuffer(params);
}

export async function resolveJobListenerActivity(params: {
  jobId: string;
  reason: ResolutionReason;
}) {
  return await resolveJobListener(params);
}

export async function settleListenerJobExecutionActivity(params: {
  jobExecutionId: string;
  status: 'failed' | 'cancelled';
}) {
  await settleListenerJobExecution(params);
}

// The listener workflow owns every firing's terminal outcome, but a workflow
// sandbox cannot emit metrics. This activity is the single recording point so
// each firing is counted exactly once, including successes that settle through
// the child's own resolution path rather than a listener DB write. The body is
// synchronous; it returns a resolved promise because Temporal invokes activities
// asynchronously.
export function recordListenerFiringOutcomeActivity(params: {
  outcome: 'succeeded' | 'failed' | 'cancelled';
}): Promise<void> {
  recordWorkflowListenerExecution(params.outcome);
  return Promise.resolve();
}
