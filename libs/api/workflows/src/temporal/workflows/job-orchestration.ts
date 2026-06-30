import {ApplicationFailure} from '@temporalio/common';
import {condition, defineSignal, log, proxyActivities, setHandler} from '@temporalio/workflow';

import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import {JOB_FINISHED_SIGNAL, JOB_LEASE_EXPIRED_SIGNAL} from '../constants.js';

/**
 * Two signals, one precedence ladder, then best-effort lease release:
 *
 *   job-finished (recordStepResult exhausted the steps) ─┐
 *   job-lease-expired (runner heartbeat went stale) ─────┤
 *                                                        ▼
 *   condition(finished ∥ leaseExpired, executionTimeout)
 *     ├─ finished      → setExecutionStatus(status) + resolve job status     ─┐
 *     ├─ leaseExpired  → resolveLeaseExpiredExecutionActivity                 ─┤→ releaseLease
 *     └─ neither (6h)  → failExecutionAsTimedOutActivity + sweep steps (NO release; the
 *                        TIMED_OUT event drives cooperative cancel, the detector reaps)
 *
 * Both signals can be delivered before condition() resumes (independent outboxes,
 * no ordering), so finished is evaluated FIRST: a genuinely-finished job is never
 * flipped to failed by a late lease-expiry. releaseLease is best-effort — a runners
 * DB outage must never block the child workflow from returning the job outcome to
 * run-orchestration; a leftover lease row is reaped by the stuck detector.
 */

const {
  setExecutionStatus,
  enqueueJobForRunner,
  bulkSetStepStatuses,
  failExecutionAsTimedOutActivity,
  resolveLeaseExpiredExecutionActivity,
  resolveJobStatusFromExecutionsActivity,
} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
});

// Lease cleanup gets a bounded retry policy of its own: after a few attempts the
// workflow stops waiting on it (see releaseLeaseBestEffort) rather than blocking
// the DAG on runners-side availability.
const {releaseLeaseActivity} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
  retry: {maximumAttempts: 5},
});

const DEFAULT_EXECUTION_MAX_DURATION = '6 hours';

export const jobFinishedSignal =
  defineSignal<[{status: RuntimeCompletionStatus}]>(JOB_FINISHED_SIGNAL);
export const jobLeaseExpiredSignal = defineSignal<[]>(JOB_LEASE_EXPIRED_SIGNAL);

export interface JobOrchestrationInput {
  workspaceId: string;
  jobId: string;
  executionId: string;
  runId: string;
  projectId: string;
  jobVersion: number;
  executionVersion: number;
  executionTimeoutMs?: number | null | undefined;
  requiredLabels: string[];
}

export interface JobOrchestrationResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

async function releaseLeaseBestEffort(executionId: string): Promise<void> {
  try {
    await releaseLeaseActivity({executionId});
  } catch (err) {
    log.warn('lease release failed; stuck detector will reap the row', {
      executionId,
      error: String(err),
    });
  }
}

function runtimeStatusForTerminalJob(status: string): RuntimeCompletionStatus {
  return status === 'succeeded' ? 'succeeded' : 'failed';
}

async function markJobRunningAndEnqueue(
  input: JobOrchestrationInput,
): Promise<
  {kind: 'running'; runningVersion: number} | {kind: 'terminal'; result: JobOrchestrationResult}
> {
  if (input.requiredLabels.every((label) => label.trim().length === 0)) {
    throw ApplicationFailure.nonRetryable(
      `Job ${input.jobId} has no required runner labels`,
      'EmptyRequiredLabelsError',
    );
  }

  const {newVersion: runningVersion, status} = await setExecutionStatus({
    executionId: input.executionId,
    status: 'running',
    version: input.executionVersion,
  });

  if (status !== undefined && status !== 'pending' && status !== 'running') {
    return {
      kind: 'terminal',
      result: {status: runtimeStatusForTerminalJob(status), jobVersion: runningVersion},
    };
  }

  await enqueueJobForRunner({
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    executionId: input.executionId,
    runId: input.runId,
    projectId: input.projectId,
    requiredLabels: input.requiredLabels,
  });

  return {kind: 'running', runningVersion};
}

interface JobOutcomeSignals {
  finished: {status: RuntimeCompletionStatus} | undefined;
  leaseExpired: boolean;
}

// Both signals can arrive before condition() resumes (independent outboxes, no
// ordering), so callers must evaluate `finished` before `leaseExpired`.
async function awaitJobOutcome(timeout: string | number): Promise<JobOutcomeSignals> {
  let finished: {status: RuntimeCompletionStatus} | undefined;
  let leaseExpired = false;
  setHandler(jobFinishedSignal, (payload) => {
    finished ??= payload;
  });
  setHandler(jobLeaseExpiredSignal, () => {
    leaseExpired = true;
  });

  await condition(() => finished !== undefined || leaseExpired, timeout);

  return {finished, leaseExpired};
}

interface JobResolution {
  input: JobOrchestrationInput;
  runningVersion: number;
}

async function resolveFinishedJob({
  input,
  runningVersion,
  status,
}: JobResolution & {status: RuntimeCompletionStatus}): Promise<JobOrchestrationResult> {
  await setExecutionStatus({
    executionId: input.executionId,
    status,
    version: runningVersion,
    statusReason: status === 'failed' ? 'step_failed' : null,
  });
  const {jobVersion} = await resolveJobStatusFromExecutionsActivity({jobId: input.jobId});
  log.info('job terminated', {jobId: input.jobId, terminationReason: 'finished', status});
  await releaseLeaseBestEffort(input.executionId);
  return {status, jobVersion};
}

async function resolveLeaseExpiredJob({
  input,
  runningVersion,
}: JobResolution): Promise<JobOrchestrationResult> {
  await resolveLeaseExpiredExecutionActivity({
    executionId: input.executionId,
    expectedVersion: runningVersion,
  });
  const {status, jobVersion} = await resolveJobStatusFromExecutionsActivity({jobId: input.jobId});
  log.info('job terminated', {jobId: input.jobId, terminationReason: 'lease_expired', status});
  await releaseLeaseBestEffort(input.executionId);
  return {status, jobVersion};
}

// Timeout backstop. The activity atomically fails the execution, marks
// `timed_out_at`, and enqueues WORKFLOWS_JOB_TIMED_OUT; the runners subscriber
// then asks the runner to cancel. The lease is intentionally NOT released here.
async function resolveTimedOutJob({
  input,
  runningVersion,
}: JobResolution): Promise<JobOrchestrationResult> {
  await failExecutionAsTimedOutActivity({
    executionId: input.executionId,
    runId: input.runId,
    expectedVersion: runningVersion,
  });
  await bulkSetStepStatuses({executionId: input.executionId, status: 'failed'});
  const {jobVersion} = await resolveJobStatusFromExecutionsActivity({jobId: input.jobId});
  log.info('job terminated', {
    jobId: input.jobId,
    terminationReason: 'max_duration',
    status: 'failed',
  });
  return {status: 'failed', jobVersion};
}

export async function jobOrchestration(
  input: JobOrchestrationInput,
): Promise<JobOrchestrationResult> {
  const running = await markJobRunningAndEnqueue(input);
  if (running.kind === 'terminal') return running.result;
  const {runningVersion} = running;

  const timeout = input.executionTimeoutMs ?? DEFAULT_EXECUTION_MAX_DURATION;
  const {finished, leaseExpired} = await awaitJobOutcome(timeout);

  // Precedence ladder: a genuinely-finished job is never flipped to failed by a
  // late lease-expiry, so `finished` wins over `leaseExpired`.
  if (finished !== undefined) {
    return resolveFinishedJob({input, runningVersion, status: finished.status});
  }
  if (leaseExpired) {
    return resolveLeaseExpiredJob({input, runningVersion});
  }
  return resolveTimedOutJob({input, runningVersion});
}
