import type {StepResultDto} from '@shipfox/api-runners-dto';
import {condition, defineSignal, proxyActivities, setHandler} from '@temporalio/workflow';

import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';

/**
 * Two terminal paths:
 *
 *   ┌─ job-completed signal arrives ──► signal payload set
 *   │   (enqueued by the per-step report      ▼
 *   │    that made the job terminal)       setJobStatus(status from signal)
 *   │                                      return {status}
 *   │   Per-step results are already persisted by recordStepResult, so the
 *   │   workflow only flips the job status — it does not re-apply step results.
 *   │
 *   └─ JOB_MAX_DURATION elapses with no signal ──► condition() returns false
 *                                                  ▼
 *                                              failJobAsTimedOutActivity
 *                                                (atomic: jobs UPDATE +
 *                                                 workflows_outbox INSERT)
 *                                                  ▼
 *                                              bulkSetStepStatuses('failed')
 *                                              return {status:'failed'}
 */

const {setJobStatus, enqueueJobForRunner, bulkSetStepStatuses, failJobAsTimedOutActivity} =
  proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
    startToCloseTimeout: '30s',
  });

const JOB_MAX_DURATION = '60 minutes';

export const jobCompletedSignal =
  defineSignal<[{status: RuntimeCompletionStatus; steps: StepResultDto[]}]>('job-completed');

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

  let signalPayload: {status: RuntimeCompletionStatus; steps: StepResultDto[]} | undefined;

  setHandler(jobCompletedSignal, (r) => {
    if (!signalPayload) {
      signalPayload = r;
    }
  });

  const completed = await condition(() => signalPayload !== undefined, JOB_MAX_DURATION);

  if (completed) {
    if (!signalPayload) {
      throw new Error('Unreachable: condition() returned true so signalPayload is set');
    }
    const {status} = signalPayload;

    // Per-step execution already persisted every step result via
    // recordStepResult (the same transaction that enqueued this signal), so the
    // DB projection is authoritative. The workflow only flips the job status.
    const {newVersion: finalVersion} = await setJobStatus({
      jobId: input.jobId,
      status,
      version: runningVersion,
    });

    return {status, jobVersion: finalVersion};
  }

  // Timeout path. The activity is the critical path for the failure decision:
  // it atomically updates the job status, marks `timed_out_at`, and enqueues
  // WORKFLOWS_JOB_TIMED_OUT in the same transaction. The runners-side
  // subscriber takes over from there to ask the runner to cancel.
  const {newVersion: finalVersion} = await failJobAsTimedOutActivity({
    jobId: input.jobId,
    runId: input.runId,
    expectedVersion: runningVersion,
  });

  await bulkSetStepStatuses({jobId: input.jobId, status: 'failed'});

  return {status: 'failed', jobVersion: finalVersion};
}
