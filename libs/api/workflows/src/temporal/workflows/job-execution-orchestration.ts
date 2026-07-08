import {ApplicationFailure} from '@temporalio/common';
import {condition, defineSignal, log, proxyActivities, setHandler} from '@temporalio/workflow';
import {
  hasNoRequiredRunnerLabels,
  type JobExecutionOutcomeSignals,
  jobExecutionStartOutcome,
  resolveJobExecutionOutcomeSignal,
} from '#core/job-execution-outcome.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import {JOB_FINISHED_SIGNAL, JOB_LEASE_EXPIRED_SIGNAL} from '../constants.js';

/**
 * Two signals, one precedence ladder, then best-effort lease release:
 *
 *   job-finished (recordStepResult exhausted the steps) ─┐
 *   job-lease-expired (runner heartbeat went stale) ─────┤
 *                                                        ▼
 *   condition(finished ∥ leaseExpired, executionTimeout)
 *     ├─ finished      → setJobExecutionStatus(status) + resolve job status     ─┐
 *     ├─ leaseExpired  → resolveLeaseExpiredJobExecutionActivity                 ─┤→ releaseLease
 *     └─ neither (6h)  → failJobExecutionAsTimedOutActivity + sweep steps (NO release; the
 *                        TIMED_OUT event drives cooperative cancel, the detector reaps)
 *
 * Both signals can be delivered before condition() resumes (independent outboxes,
 * no ordering), so finished is evaluated FIRST: a genuinely-finished job is never
 * flipped to failed by a late lease-expiry. releaseLease is best-effort — a runners
 * DB outage must never block the child workflow from returning the job outcome to
 * run-orchestration; a leftover lease row is reaped by the stuck detector.
 */

const {
  setJobStatus,
  setJobExecutionStatus,
  enqueueJobExecutionForRunner,
  bulkSetStepStatuses,
  failJobExecutionAsTimedOutActivity,
  resolveLeaseExpiredJobExecutionActivity,
} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
});

const {resolveJobStatusFromJobExecutionsActivity} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
  retry: {maximumAttempts: 5},
});

// Lease cleanup gets a bounded retry policy of its own: after a few attempts the
// workflow stops waiting on it (see releaseLeaseBestEffort) rather than blocking
// the DAG on runners-side availability.
const {releaseLeaseActivity} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
  retry: {maximumAttempts: 5},
});

const DEFAULT_EXECUTION_MAX_DURATION_MS = 6 * 60 * 60 * 1000;

export const jobFinishedSignal =
  defineSignal<[{status: RuntimeCompletionStatus; jobExecutionId?: string | undefined}]>(
    JOB_FINISHED_SIGNAL,
  );
export const jobLeaseExpiredSignal =
  defineSignal<[{jobExecutionId?: string | undefined}]>(JOB_LEASE_EXPIRED_SIGNAL);

export interface JobExecutionOrchestrationInput {
  workspaceId: string;
  workflowRunId: string;
  runAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  projectId: string;
  jobVersion: number;
  executionVersion: number;
  executionTimeoutMs?: number | null | undefined;
  resolveJobStatus?: boolean | undefined;
  requiredLabels: string[];
}

export interface JobExecutionOrchestrationResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

async function releaseLeaseBestEffort(jobExecutionId: string): Promise<void> {
  try {
    await releaseLeaseActivity({jobExecutionId});
  } catch (err) {
    log.warn('lease release failed; stuck detector will reap the row', {
      jobExecutionId,
      error: String(err),
    });
  }
}

async function resolveJobStatusOrFailClosed(
  input: JobExecutionOrchestrationInput,
): Promise<{status: RuntimeCompletionStatus; jobVersion: number}> {
  try {
    return await resolveJobStatusFromJobExecutionsActivity({jobId: input.jobId});
  } catch (err) {
    log.error('job status resolution failed; failing job closed', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      error: String(err),
    });
    const {newVersion} = await setJobStatus({
      jobId: input.jobId,
      status: 'failed',
      version: input.jobVersion,
      statusReason: 'step_failed',
    });
    return {status: 'failed', jobVersion: newVersion};
  }
}

async function markJobExecutionRunningAndEnqueue(
  input: JobExecutionOrchestrationInput,
): Promise<
  | {kind: 'running'; runningVersion: number}
  | {kind: 'terminal'; result: JobExecutionOrchestrationResult}
> {
  if (hasNoRequiredRunnerLabels(input.requiredLabels)) {
    throw ApplicationFailure.nonRetryable(
      `Job ${input.jobId} has no required runner labels`,
      'EmptyRequiredLabelsError',
    );
  }

  const {newVersion: runningVersion, status} = await setJobExecutionStatus({
    jobExecutionId: input.jobExecutionId,
    status: 'running',
    version: input.executionVersion,
  });

  const start = jobExecutionStartOutcome({newVersion: runningVersion, status});
  if (start.kind === 'terminal') return start;

  await enqueueJobExecutionForRunner({
    workspaceId: input.workspaceId,
    workflowRunId: input.workflowRunId,
    runAttemptId: input.runAttemptId,
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    projectId: input.projectId,
    requiredLabels: input.requiredLabels,
  });

  return {kind: 'running', runningVersion};
}

// Both signals can arrive before condition() resumes (independent outboxes, no
// ordering), so callers must evaluate `finished` before `leaseExpired`.
async function awaitJobOutcome(
  jobExecutionId: string,
  timeoutMs: number,
): Promise<JobExecutionOutcomeSignals> {
  let finished: {status: RuntimeCompletionStatus; jobExecutionId?: string | undefined} | undefined;
  let leaseExpired = false;
  setHandler(jobFinishedSignal, (payload) => {
    if (payload.jobExecutionId !== undefined && payload.jobExecutionId !== jobExecutionId) return;
    finished ??= payload;
  });
  setHandler(jobLeaseExpiredSignal, (payload = {}) => {
    if (payload.jobExecutionId !== undefined && payload.jobExecutionId !== jobExecutionId) return;
    leaseExpired = true;
  });

  await condition(() => finished !== undefined || leaseExpired, timeoutMs);

  return {finished, leaseExpired};
}

interface JobExecutionResolution {
  input: JobExecutionOrchestrationInput;
  runningVersion: number;
}

async function resolveFinishedJobExecution({
  input,
  runningVersion,
  status,
}: JobExecutionResolution & {
  status: RuntimeCompletionStatus;
}): Promise<JobExecutionOrchestrationResult> {
  await setJobExecutionStatus({
    jobExecutionId: input.jobExecutionId,
    status: jobExecutionStatusForRuntimeStatus(status),
    version: runningVersion,
    statusReason: status === 'failed' ? 'step_failed' : null,
  });
  if (input.resolveJobStatus === false) {
    log.info('job execution terminated', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      terminationReason: 'finished',
      status,
    });
    await releaseLeaseBestEffort(input.jobExecutionId);
    return {status, jobVersion: input.jobVersion};
  }
  const resolved = await resolveJobStatusOrFailClosed(input);
  log.info('job execution terminated', {
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    terminationReason: 'finished',
    status: resolved.status,
  });
  await releaseLeaseBestEffort(input.jobExecutionId);
  return resolved;
}

function jobExecutionStatusForRuntimeStatus(
  status: RuntimeCompletionStatus,
): 'succeeded' | 'failed' | 'cancelled' {
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return status;
  throw ApplicationFailure.nonRetryable(
    `Job execution cannot be marked ${status}`,
    'InvalidJobExecutionStatusError',
  );
}

async function resolveLeaseExpiredJobExecution({
  input,
  runningVersion,
}: JobExecutionResolution): Promise<JobExecutionOrchestrationResult> {
  const leaseExpired = await resolveLeaseExpiredJobExecutionActivity({
    jobExecutionId: input.jobExecutionId,
    expectedVersion: runningVersion,
  });
  if (input.resolveJobStatus === false) {
    log.info('job execution terminated', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      terminationReason: 'lease_expired',
      status: leaseExpired.status,
    });
    await releaseLeaseBestEffort(input.jobExecutionId);
    return {status: leaseExpired.status, jobVersion: input.jobVersion};
  }
  const {status, jobVersion} = await resolveJobStatusOrFailClosed(input);
  log.info('job execution terminated', {
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    terminationReason: 'lease_expired',
    status,
  });
  await releaseLeaseBestEffort(input.jobExecutionId);
  return {status, jobVersion};
}

// Timeout backstop. The activity atomically fails the execution, marks
// `timed_out_at`, and enqueues WORKFLOWS_JOB_EXECUTION_TIMED_OUT; the runners subscriber
// then asks the runner to cancel. The lease is intentionally NOT released here.
async function resolveTimedOutJobExecution({
  input,
  runningVersion,
}: JobExecutionResolution): Promise<JobExecutionOrchestrationResult> {
  await failJobExecutionAsTimedOutActivity({
    jobExecutionId: input.jobExecutionId,
    runAttemptId: input.runAttemptId,
    expectedVersion: runningVersion,
  });
  await bulkSetStepStatuses({jobExecutionId: input.jobExecutionId, status: 'failed'});
  if (input.resolveJobStatus === false) {
    log.info('job execution terminated', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      terminationReason: 'max_duration',
      status: 'failed',
    });
    return {status: 'failed', jobVersion: input.jobVersion};
  }
  const {jobVersion} = await resolveJobStatusOrFailClosed(input);
  log.info('job execution terminated', {
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    terminationReason: 'max_duration',
    status: 'failed',
  });
  return {status: 'failed', jobVersion};
}

export async function jobExecutionOrchestration(
  input: JobExecutionOrchestrationInput,
): Promise<JobExecutionOrchestrationResult> {
  const running = await markJobExecutionRunningAndEnqueue(input);
  if (running.kind === 'terminal') {
    if (input.resolveJobStatus === false) {
      return {status: running.result.status, jobVersion: input.jobVersion};
    }
    return running.result;
  }
  const {runningVersion} = running;

  const timeoutMs = input.executionTimeoutMs ?? DEFAULT_EXECUTION_MAX_DURATION_MS;
  const signals = await awaitJobOutcome(input.jobExecutionId, timeoutMs);

  // Precedence ladder: a genuinely-finished job is never flipped to failed by a
  // late lease-expiry, so `finished` wins over `leaseExpired`.
  const resolution = resolveJobExecutionOutcomeSignal(signals);
  if (resolution === 'finished') {
    const {finished} = signals;
    if (finished === undefined) throw new Error('Missing finished signal for finished resolution');

    return resolveFinishedJobExecution({input, runningVersion, status: finished.status});
  }
  if (resolution === 'lease-expired') {
    return resolveLeaseExpiredJobExecution({input, runningVersion});
  }
  return resolveTimedOutJobExecution({input, runningVersion});
}
