import {instanceMetrics} from '@shipfox/node-opentelemetry';
import type {JobStatus} from '#core/entities/job.js';
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

const jobQueuedCount = meter.createCounter<Record<string, never>>('workflows_job_queued', {
  description: 'Workflow jobs first marked as queued from runner queue events',
});

const jobStartedCount = meter.createCounter<Record<string, never>>('workflows_job_started', {
  description: 'Workflow jobs first marked as started from runner claim events',
});

const jobStepsSettledCount = meter.createCounter<{
  status: Extract<RuntimeCompletionStatus, 'failed' | 'succeeded'>;
}>('workflows_job_steps_settled', {
  description: 'Job steps-settled events enqueued by resulting completion status',
});

const jobTimedOutCount = meter.createCounter<Record<string, never>>('workflows_job_timed_out', {
  description: 'Workflow jobs failed by the job orchestration timeout path',
});

const jobLeaseExpiryResolvedCount = meter.createCounter<{status: RuntimeCompletionStatus}>(
  'workflows_job_lease_expiry_resolved',
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

export function recordWorkflowJobQueued(): void {
  jobQueuedCount.add(1);
}

export function recordWorkflowJobStarted(): void {
  jobStartedCount.add(1);
}

export function recordWorkflowJobStepsSettled(
  status: Extract<RuntimeCompletionStatus, 'failed' | 'succeeded'>,
): void {
  jobStepsSettledCount.add(1, {status});
}

export function recordWorkflowJobTimedOut(): void {
  jobTimedOutCount.add(1);
}

export function recordWorkflowJobLeaseExpiryResolved(status: RuntimeCompletionStatus): void {
  jobLeaseExpiryResolvedCount.add(1, {status});
}

export function recordWorkflowStepRestartEnqueued(): void {
  stepRestartEnqueuedCount.add(1);
}
