import type {RunnerJobLossCauseDto} from '@shipfox/api-runners-dto';
import {ApplicationFailure} from '@temporalio/common';
import {
  condition,
  defineSignal,
  log,
  patched,
  proxyActivities,
  setHandler,
} from '@temporalio/workflow';
import type {JobExecutionLimits} from '#core/execution-limits.js';
import {
  DEFAULT_EXECUTION_MAX_DURATION_MS,
  resolveJobExecutionDuration,
} from '#core/execution-limits.js';
import {
  hasNoRequiredRunnerLabels,
  type JobExecutionOutcomeSignals,
  jobExecutionStartOutcome,
  resolveJobExecutionOutcomeSignal,
} from '#core/job-execution-outcome.js';
import type {RuntimeCompletionStatus} from '#core/workflow-scheduling/runtime-dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';
import {JOB_CLAIMED_SIGNAL, JOB_FINISHED_SIGNAL, JOB_LEASE_EXPIRED_SIGNAL} from '../constants.js';
import {remainingMs} from './deadline.js';

/**
 * Enqueue, wait for the runner claim, then wait for one of the terminal facts:
 *
 *   enqueue ──> PENDING ── job-claimed ──> RUNNING
 *                 │                          │
 *                 │ timeout                  ├─ job-finished
 *                 │                          ├─ job-lease-expired
 *                 ▼                          └─ timeout
 *              TERMINAL
 *
 * The claim signal is the runner-owned lifecycle boundary. The workflow keeps the
 * execution pending while it is queued, then performs the versioned pending → running
 * transition after the current claim. One deadline spans both waits; claim never resets
 * it. Signals can arrive in any order, so the precedence is finished > lease expired >
 * claimed > timeout. Workflows commits queue and terminal facts with its state transitions;
 * runners reconciles its local queue, lease, and reservation projections asynchronously.
 */

const {
  setJobStatus,
  setJobExecutionStatus,
  queueJobExecutionActivity,
  expireQueuedJobExecutionActivity,
  failJobExecutionAsTimedOutActivity,
  resolveLeaseExpiredJobExecutionActivity,
} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
  startToCloseTimeout: '30s',
});

const {resolveExecutionLimitsActivity} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '5s',
});

const {resolveJobStatusFromJobExecutionsActivity} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
  retry: {maximumAttempts: 5},
});

export const jobFinishedSignal =
  defineSignal<[{status: RuntimeCompletionStatus; jobExecutionId?: string | undefined}]>(
    JOB_FINISHED_SIGNAL,
  );
export interface JobLeaseExpiredSignalPayload {
  jobExecutionId?: string | undefined;
  cause?: RunnerJobLossCauseDto | undefined;
}
export const jobLeaseExpiredSignal =
  defineSignal<[JobLeaseExpiredSignalPayload]>(JOB_LEASE_EXPIRED_SIGNAL);
export interface JobClaimedSignalPayload {
  jobExecutionId: string;
  claimedAt: string;
  provisionerScope?: 'installation' | 'workspace' | null | undefined;
}
export const jobClaimedSignal = defineSignal<[JobClaimedSignalPayload]>(JOB_CLAIMED_SIGNAL);

export interface JobExecutionOrchestrationInput {
  runAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  jobVersion: number;
  executionVersion: number;
  executionTimeoutMs?: number | null | undefined;
  resolveJobStatus?: boolean | undefined;
  requiredLabels: string[];
  workspaceId?: string | undefined;
  projectId?: string | undefined;
}

export interface JobExecutionOrchestrationResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
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

async function queueJobExecution(input: JobExecutionOrchestrationInput) {
  const queued = await queueJobExecutionActivity({
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
  });
  return {
    ...jobExecutionStartOutcome(queued),
    queuedAt: queued.queuedAt,
    queueTimeoutMs: queued.queueTimeoutMs,
  };
}

async function markJobExecutionRunning(
  input: JobExecutionOrchestrationInput,
  runningVersion: number,
  claim: JobClaimedSignalPayload,
  durationLimits: JobExecutionLimits | null,
): Promise<
  | {kind: 'running'; runningVersion: number}
  | {kind: 'terminal'; result: JobExecutionOrchestrationResult}
> {
  const {newVersion: markedVersion, status} = await setJobExecutionStatus({
    jobExecutionId: input.jobExecutionId,
    status: 'running',
    version: runningVersion,
    executionTimeoutMs: input.executionTimeoutMs,
    provisionerScope: claim.provisionerScope,
    durationLimits,
  });

  const start = jobExecutionStartOutcome({newVersion: markedVersion, status});
  if (start.kind === 'terminal') return start;
  return {kind: 'running', runningVersion: markedVersion};
}

interface JobExecutionSignals extends JobExecutionOutcomeSignals {
  claimed: JobClaimedSignalPayload | undefined;
}

function registerJobExecutionSignalHandlers(
  jobExecutionId: string,
  signals: JobExecutionSignals,
): void {
  setHandler(jobFinishedSignal, (payload) => {
    if (payload.jobExecutionId !== undefined && payload.jobExecutionId !== jobExecutionId) return;
    signals.finished ??= payload;
  });
  setHandler(jobLeaseExpiredSignal, (payload = {}) => {
    if (payload.jobExecutionId !== undefined && payload.jobExecutionId !== jobExecutionId) return;
    signals.leaseExpired = true;
    signals.leaseExpiredCause ??= payload.cause;
  });
  setHandler(jobClaimedSignal, (payload) => {
    if (payload.jobExecutionId !== jobExecutionId) return;
    signals.claimed ??= payload;
  });
}

async function waitForJobExecutionSignal(
  signals: JobExecutionSignals,
  deadline: number,
  includeClaim: boolean,
): Promise<boolean> {
  return await condition(
    () =>
      signals.finished !== undefined ||
      signals.leaseExpired ||
      (includeClaim && signals.claimed !== undefined),
    remainingMs(deadline) ?? 0,
  );
}

function queueTimeoutMessage(timeoutMs: number): string {
  if (timeoutMs % (60 * 60 * 1000) === 0) {
    return `Not started within ${timeoutMs / (60 * 60 * 1000)} h`;
  }
  if (timeoutMs % (60 * 1000) === 0) return `Not started within ${timeoutMs / (60 * 1000)} m`;
  return `Not started within ${timeoutMs / 1000} s`;
}

async function resolveQueueTimedOutJobExecution(
  input: JobExecutionOrchestrationInput,
  queueTimeoutMs: number,
): Promise<JobExecutionOrchestrationResult> {
  await setJobExecutionStatus({
    jobExecutionId: input.jobExecutionId,
    status: 'failed',
    version: input.executionVersion,
    statusReason: 'queue_timed_out',
    statusReasonMessage: queueTimeoutMessage(queueTimeoutMs),
  });
  if (input.resolveJobStatus === false) {
    return {status: 'failed', jobVersion: input.jobVersion};
  }
  const {jobVersion} = await resolveJobStatusOrFailClosed(input);
  return {status: 'failed', jobVersion};
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
    return {status, jobVersion: input.jobVersion};
  }
  const resolved = await resolveJobStatusOrFailClosed(input);
  log.info('job execution terminated', {
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    terminationReason: 'finished',
    status: resolved.status,
  });
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
  cause,
}: JobExecutionResolution & {
  cause: RunnerJobLossCauseDto | undefined;
}): Promise<JobExecutionOrchestrationResult> {
  const activityParams = {
    jobExecutionId: input.jobExecutionId,
    expectedVersion: runningVersion,
    ...(cause === undefined ? {} : {runnerLossCause: cause}),
  };
  const leaseExpired = await resolveLeaseExpiredJobExecutionActivity(activityParams);
  if (input.resolveJobStatus === false) {
    log.info('job execution terminated', {
      jobId: input.jobId,
      jobExecutionId: input.jobExecutionId,
      terminationReason: 'lease_expired',
      status: leaseExpired.status,
    });
    return {status: leaseExpired.status, jobVersion: input.jobVersion};
  }
  const {status, jobVersion} = await resolveJobStatusOrFailClosed(input);
  log.info('job execution terminated', {
    jobId: input.jobId,
    jobExecutionId: input.jobExecutionId,
    terminationReason: 'lease_expired',
    status,
  });
  return {status, jobVersion};
}

// Timeout backstop. The activity atomically fails the execution, marks `timed_out_at`, and
// enqueues the generic terminal execution fact. The runners subscriber then asks the runner to
// cancel. The lease is intentionally NOT released here.
async function resolveTimedOutJobExecution({
  input,
  runningVersion,
}: JobExecutionResolution): Promise<JobExecutionOrchestrationResult> {
  await failJobExecutionAsTimedOutActivity({
    jobExecutionId: input.jobExecutionId,
    runAttemptId: input.runAttemptId,
    expectedVersion: runningVersion,
  });
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

type QueuedJobExecution = Awaited<ReturnType<typeof queueJobExecution>>;
type PreRunningResolution =
  | {kind: 'claimed'; deadline: number; claim: JobClaimedSignalPayload}
  | {kind: 'terminal'; result: JobExecutionOrchestrationResult};

function claimDeadline(
  input: JobExecutionOrchestrationInput,
  claimedAt: string,
  provisionerScope: string | null | undefined,
  durationLimits: JobExecutionLimits | null,
): number {
  const timestamp = Date.parse(claimedAt);
  if (!Number.isFinite(timestamp)) {
    throw ApplicationFailure.nonRetryable(
      `Job execution ${input.jobExecutionId} has an invalid claim timestamp`,
      'InvalidClaimedAtError',
    );
  }
  const duration = resolveJobExecutionDuration({
    requestedMs: input.executionTimeoutMs,
    provisionerScope,
    limits: durationLimits,
  });
  return timestamp + duration.effectiveMs;
}

async function resolveUnpatchedBeforeRunning(
  input: JobExecutionOrchestrationInput,
  signals: JobExecutionSignals,
): Promise<PreRunningResolution> {
  const deadline = Date.now() + (input.executionTimeoutMs ?? DEFAULT_EXECUTION_MAX_DURATION_MS);
  await waitForJobExecutionSignal(signals, deadline, true);
  const resolution = resolveJobExecutionOutcomeSignal(signals);
  if (resolution === 'finished') {
    const {finished} = signals;
    if (finished === undefined) throw new Error('Missing finished signal for finished resolution');
    return {
      kind: 'terminal',
      result: await resolveFinishedJobExecution({
        input,
        runningVersion: input.executionVersion,
        status: finished.status,
      }),
    };
  }
  if (resolution === 'lease-expired') {
    return {
      kind: 'terminal',
      result: await resolveLeaseExpiredJobExecution({
        input,
        runningVersion: input.executionVersion,
        cause: signals.leaseExpiredCause,
      }),
    };
  }
  if (!signals.claimed) {
    return {
      kind: 'terminal',
      result: await resolveTimedOutJobExecution({input, runningVersion: input.executionVersion}),
    };
  }
  return {kind: 'claimed', deadline, claim: signals.claimed};
}

async function resolvePatchedBeforeRunning(
  input: JobExecutionOrchestrationInput,
  queued: QueuedJobExecution,
  signals: JobExecutionSignals,
  durationLimits: JobExecutionLimits | null,
): Promise<PreRunningResolution> {
  if (queued.queuedAt === null) {
    throw ApplicationFailure.nonRetryable(
      `Job execution ${input.jobExecutionId} has no persisted queue timestamp`,
      'MissingQueuedAtError',
    );
  }
  const queuedAt = Date.parse(queued.queuedAt);
  if (!Number.isFinite(queuedAt)) {
    throw ApplicationFailure.nonRetryable(
      `Job execution ${input.jobExecutionId} has an invalid queue timestamp`,
      'InvalidQueuedAtError',
    );
  }
  await waitForJobExecutionSignal(signals, queuedAt + queued.queueTimeoutMs, true);
  const resolution = resolveJobExecutionOutcomeSignal(signals);
  if (resolution === 'finished') {
    const {finished} = signals;
    if (finished === undefined) throw new Error('Missing finished signal for finished resolution');
    return {
      kind: 'terminal',
      result: await resolveFinishedJobExecution({
        input,
        runningVersion: input.executionVersion,
        status: finished.status,
      }),
    };
  }
  if (resolution === 'lease-expired') {
    return {
      kind: 'terminal',
      result: await resolveLeaseExpiredJobExecution({
        input,
        runningVersion: input.executionVersion,
        cause: signals.leaseExpiredCause,
      }),
    };
  }
  if (!signals.claimed) {
    const expired = await expireQueuedJobExecutionActivity({
      jobExecutionId: input.jobExecutionId,
    });
    if (expired.kind === 'expired' || expired.kind === 'absent') {
      return {
        kind: 'terminal',
        result: await resolveQueueTimedOutJobExecution(input, queued.queueTimeoutMs),
      };
    }
    signals.claimed = {
      jobExecutionId: input.jobExecutionId,
      claimedAt: expired.claimedAt,
      provisionerScope: expired.provisionerScope,
    };
  }
  return {
    kind: 'claimed',
    deadline: claimDeadline(
      input,
      signals.claimed.claimedAt,
      signals.claimed.provisionerScope,
      durationLimits,
    ),
    claim: signals.claimed,
  };
}

function resolveBeforeRunning(
  input: JobExecutionOrchestrationInput,
  queued: QueuedJobExecution,
  signals: JobExecutionSignals,
  durationLimits: JobExecutionLimits | null,
): Promise<PreRunningResolution> {
  return patched('job-queue-timeout')
    ? resolvePatchedBeforeRunning(input, queued, signals, durationLimits)
    : resolveUnpatchedBeforeRunning(input, signals);
}

export async function jobExecutionOrchestration(
  input: JobExecutionOrchestrationInput,
): Promise<JobExecutionOrchestrationResult> {
  const signals: JobExecutionSignals = {
    finished: undefined,
    leaseExpired: false,
    leaseExpiredCause: undefined,
    claimed: undefined,
  };
  // Register every signal before enqueue can block or publish a claim/outcome event. The
  // handlers retain signals that arrive while the enqueue activity is in flight.
  registerJobExecutionSignalHandlers(input.jobExecutionId, signals);
  if (hasNoRequiredRunnerLabels(input.requiredLabels)) {
    throw ApplicationFailure.nonRetryable(
      `Job ${input.jobId} has no required runner labels`,
      'EmptyRequiredLabelsError',
    );
  }
  const durationLimits = patched('job-execution-limits')
    ? await resolveExecutionLimitsActivity({
        workspaceId: input.workspaceId ?? '',
        projectId: input.projectId ?? '',
        jobExecutionId: input.jobExecutionId,
      })
    : null;
  const queued = await queueJobExecution(input);
  if (queued.kind === 'terminal') {
    return {status: queued.result.status, jobVersion: input.jobVersion};
  }

  const preRunning = await resolveBeforeRunning(input, queued, signals, durationLimits);
  if (preRunning.kind === 'terminal') return preRunning.result;

  const {deadline} = preRunning;
  const running = await markJobExecutionRunning(
    input,
    input.executionVersion,
    preRunning.claim,
    durationLimits,
  );
  if (running.kind === 'terminal') {
    if (input.resolveJobStatus === false) {
      return {status: running.result.status, jobVersion: input.jobVersion};
    }
    return running.result;
  }
  const {runningVersion} = running;

  await waitForJobExecutionSignal(signals, deadline, false);
  const resolution = resolveJobExecutionOutcomeSignal(signals);
  if (resolution === 'finished') {
    const {finished} = signals;
    if (finished === undefined) throw new Error('Missing finished signal for finished resolution');
    return resolveFinishedJobExecution({input, runningVersion, status: finished.status});
  }
  if (resolution === 'lease-expired') {
    return resolveLeaseExpiredJobExecution({
      input,
      runningVersion,
      cause: signals.leaseExpiredCause,
    });
  }
  return resolveTimedOutJobExecution({input, runningVersion});
}
