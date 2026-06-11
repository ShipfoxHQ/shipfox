import type {StepResultDto} from '@shipfox/api-runners-dto';
import {condition, defineSignal, proxyActivities, setHandler} from '@temporalio/workflow';

import type {RuntimeCompletionStatus} from '#core/entities/runtime-dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';

/**
 * Two terminal paths:
 *
 *   ┌─ job-completed signal arrives ──► signal payload set
 *   │                                     ▼
 *   │   Per-step runner: the report that made the job terminal already
 *   │   persisted every step result and signals with no steps, so we only
 *   │   setJobStatus(status). Legacy job-atomic runner: /complete signals with
 *   │   the reported steps, which we still applyStepResultsActivity(steps) here
 *   │   so a mixed-version rollout cannot leave the projection behind the
 *   │   job status. Then setJobStatus(status); return {status}.
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

const {
  setJobStatus,
  enqueueJobForRunner,
  bulkSetStepStatuses,
  applyStepResultsActivity,
  failJobAsTimedOutActivity,
} = proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
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
    const {status, steps} = signalPayload;

    // Per-step execution persists each result as it is reported (the same
    // transaction that enqueued this signal) and signals with no steps, so the
    // projection is already authoritative. A legacy job-atomic runner reports
    // everything at once via /complete and the signal carries the steps; persist
    // those here so a mixed-version rollout cannot leave step rows behind the
    // (now authoritative) job status.
    if (steps.length > 0) {
      await applyStepResultsActivity({
        jobId: input.jobId,
        completionStatus: status,
        reportedSteps: steps,
      });
    }

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
