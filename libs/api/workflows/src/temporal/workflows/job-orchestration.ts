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
 *   condition(finished ∥ leaseExpired, JOB_MAX_DURATION)
 *     ├─ finished      → setJobStatus(status)                              ─┐
 *     ├─ leaseExpired  → resolveLeaseExpiredJobActivity (server state wins) ─┤→ releaseLease
 *     └─ neither (60m) → failJobAsTimedOutActivity + sweep steps (NO release; the
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
  enqueueJobForRunner,
  bulkSetStepStatuses,
  failJobAsTimedOutActivity,
  resolveLeaseExpiredJobActivity,
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

const JOB_MAX_DURATION = '60 minutes';

export const jobFinishedSignal =
  defineSignal<[{status: RuntimeCompletionStatus}]>(JOB_FINISHED_SIGNAL);
export const jobLeaseExpiredSignal = defineSignal<[]>(JOB_LEASE_EXPIRED_SIGNAL);

export interface JobOrchestrationInput {
  workspaceId: string;
  jobId: string;
  runId: string;
  jobVersion: number;
}

export interface JobOrchestrationResult {
  status: RuntimeCompletionStatus;
  jobVersion: number;
}

async function releaseLeaseBestEffort(jobId: string): Promise<void> {
  try {
    await releaseLeaseActivity({jobId});
  } catch (err) {
    log.warn('lease release failed; stuck detector will reap the row', {
      jobId,
      error: String(err),
    });
  }
}

export async function jobOrchestration(
  input: JobOrchestrationInput,
): Promise<JobOrchestrationResult> {
  const {newVersion: runningVersion} = await setJobStatus({
    jobId: input.jobId,
    status: 'running',
    version: input.jobVersion,
  });

  await enqueueJobForRunner({
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    runId: input.runId,
  });

  let finished: {status: RuntimeCompletionStatus} | undefined;
  let leaseExpired = false;
  setHandler(jobFinishedSignal, (payload) => {
    finished ??= payload;
  });
  setHandler(jobLeaseExpiredSignal, () => {
    leaseExpired = true;
  });

  await condition(() => finished !== undefined || leaseExpired, JOB_MAX_DURATION);

  let status: RuntimeCompletionStatus;
  let jobVersion: number;

  if (finished !== undefined) {
    status = finished.status;
    ({newVersion: jobVersion} = await setJobStatus({
      jobId: input.jobId,
      status,
      version: runningVersion,
    }));
    log.info('job terminated', {jobId: input.jobId, terminationReason: 'finished', status});
    await releaseLeaseBestEffort(input.jobId);
  } else if (leaseExpired) {
    ({status, jobVersion} = await resolveLeaseExpiredJobActivity({
      jobId: input.jobId,
      expectedVersion: runningVersion,
    }));
    log.info('job terminated', {jobId: input.jobId, terminationReason: 'lease_expired', status});
    await releaseLeaseBestEffort(input.jobId);
  } else {
    // Timeout backstop. The activity atomically fails the job, marks `timed_out_at`,
    // and enqueues WORKFLOWS_JOB_TIMED_OUT; the runners subscriber then asks the
    // runner to cancel. The lease is intentionally NOT released here.
    ({newVersion: jobVersion} = await failJobAsTimedOutActivity({
      jobId: input.jobId,
      runId: input.runId,
      expectedVersion: runningVersion,
    }));
    await bulkSetStepStatuses({jobId: input.jobId, status: 'failed'});
    status = 'failed';
    log.info('job terminated', {jobId: input.jobId, terminationReason: 'max_duration', status});
  }

  return {status, jobVersion};
}
