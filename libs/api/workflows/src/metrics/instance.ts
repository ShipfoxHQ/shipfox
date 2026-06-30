import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {JobStatus} from '#core/entities/job.js';
import type {JobExecutionStatus} from '#core/entities/job-execution.js';
import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';
import type {WorkflowRunStatus} from '#core/entities/workflow-run.js';

const meter = instanceMetrics.getMeter('workflows');

const runCreatedCount = meter.createCounter<{provider: string}>('workflows_run_created', {
  description: 'Workflow runs created by bounded trigger provider',
});

const runStatusChangedCount = meter.createCounter<{status: WorkflowRunStatus}>(
  'workflows_run_status_changed',
  {description: 'Workflow run status transitions by resulting status'},
);

const jobStatusChangedCount = meter.createCounter<{status: JobStatus}>(
  'workflows_job_status_changed',
  {description: 'Workflow job status transitions by resulting status'},
);

const jobExecutionStatusChangedCount = meter.createCounter<{status: JobExecutionStatus}>(
  'workflows_job_execution_status_changed',
  {description: 'Workflow job execution status transitions by resulting status'},
);

const jobExecutionQueuedCount = meter.createCounter<Record<string, never>>(
  'workflows_job_execution_queued',
  {
    description: 'Workflow job executions first marked as queued from runner queue events',
  },
);

const jobExecutionStartedCount = meter.createCounter<Record<string, never>>(
  'workflows_job_execution_started',
  {
    description: 'Workflow job executions first marked as started from runner claim events',
  },
);

const jobExecutionStepsSettledCount = meter.createCounter<{
  status: Extract<RuntimeCompletionStatus, 'failed' | 'succeeded'>;
}>('workflows_job_execution_steps_settled', {
  description: 'Job execution steps-settled events enqueued by resulting completion status',
});

const jobExecutionTimedOutCount = meter.createCounter<Record<string, never>>(
  'workflows_job_execution_timed_out',
  {
    description: 'Workflow job executions failed by the execution orchestration timeout path',
  },
);

const jobExecutionLeaseExpiryResolvedCount = meter.createCounter<{status: RuntimeCompletionStatus}>(
  'workflows_job_execution_lease_expiry_resolved',
  {description: 'Runner lease-expiry resolutions by resulting runtime status'},
);

const stepRestartEnqueuedCount = meter.createCounter<Record<string, never>>(
  'workflows_step_restart_enqueued',
  {description: 'Durable step restart events enqueued after a restartable gate failure'},
);

export function recordWorkflowRunCreated(provider: string): void {
  runCreatedCount.add(1, {provider});
}

export function recordWorkflowRunStatusChanged(status: WorkflowRunStatus): void {
  runStatusChangedCount.add(1, {status});
}

export function recordWorkflowJobStatusChanged(status: JobStatus): void {
  jobStatusChangedCount.add(1, {status});
}

export function recordWorkflowJobExecutionStatusChanged(status: JobExecutionStatus): void {
  jobExecutionStatusChangedCount.add(1, {status});
}

export function recordWorkflowJobExecutionQueued(): void {
  jobExecutionQueuedCount.add(1);
}

export function recordWorkflowJobExecutionStarted(): void {
  jobExecutionStartedCount.add(1);
}

export function recordWorkflowJobExecutionStepsSettled(
  status: Extract<RuntimeCompletionStatus, 'failed' | 'succeeded'>,
): void {
  jobExecutionStepsSettledCount.add(1, {status});
}

export function recordWorkflowJobExecutionTimedOut(): void {
  jobExecutionTimedOutCount.add(1);
}

export function recordWorkflowJobExecutionLeaseExpiryResolved(
  status: RuntimeCompletionStatus,
): void {
  jobExecutionLeaseExpiryResolvedCount.add(1, {status});
}

export function recordWorkflowStepRestartEnqueued(): void {
  stepRestartEnqueuedCount.add(1);
}
