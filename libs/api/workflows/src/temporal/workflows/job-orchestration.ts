import type {StepResultDto} from '@shipfox/api-runners-dto';
import {condition, defineSignal, proxyActivities, setHandler} from '@temporalio/workflow';

import type {CompletionStatus} from '#core/dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';

/**
 * Two terminal paths:
 *
 *   ┌─ runner POST /complete arrives ──► signal payload set
 *   │                                     ▼
 *   │                                  setJobStatus(status from signal)
 *   │                                  applyStepResultsActivity(reportedSteps)
 *   │                                  return {status}
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
  defineSignal<[{status: CompletionStatus; steps: StepResultDto[]}]>('job-completed');

export interface JobOrchestrationInput {
  workspaceId: string;
  jobId: string;
  runId: string;
  jobName: string;
  jobVersion: number;
  steps: Array<{
    id: string;
    name: string | null;
    type: string;
    config: Record<string, unknown>;
    position: number;
  }>;
}

export interface JobOrchestrationResult {
  status: CompletionStatus;
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
    jobName: input.jobName,
    steps: input.steps,
  });

  let signalPayload: {status: CompletionStatus; steps: StepResultDto[]} | undefined;

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

    const {newVersion: finalVersion} = await setJobStatus({
      jobId: input.jobId,
      status,
      version: runningVersion,
    });

    await applyStepResultsActivity({jobId: input.jobId, reportedSteps: steps});

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
