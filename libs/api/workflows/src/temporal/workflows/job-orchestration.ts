import {condition, defineSignal, proxyActivities, setHandler} from '@temporalio/workflow';

import type {CompletionStatus} from '#core/dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';

/**
 * Two terminal paths for a single job orchestration:
 *
 *   ┌─ runner POST /complete arrives ──► signal payload set
 *   │                                     ▼
 *   │                                  setJobStatus(status from signal)
 *   │                                  bulkSetStepStatuses(status)
 *   │                                  return {status, output}
 *   │
 *   └─ JOB_MAX_DURATION elapses with no signal ──► condition() returns false
 *                                                  ▼
 *                                              failJobAsTimedOutActivity
 *                                                (atomic: jobs UPDATE +
 *                                                 workflows_outbox INSERT
 *                                                 with WORKFLOWS_JOB_TIMED_OUT)
 *                                                  ▼
 *                                              bulkSetStepStatuses('failed')
 *                                              return {status:'failed',
 *                                                      output:{reason:'job_timeout'}}
 *
 * The runner-cancellation side-effect is now driven asynchronously: the runners
 * module subscribes to WORKFLOWS_JOB_TIMED_OUT and calls requestJobCancellation
 * inside its own module. That decoupling keeps workflows ↔ runners
 * communication event-driven rather than via direct cross-module imports.
 */

const {setJobStatus, enqueueJobForRunner, bulkSetStepStatuses, failJobAsTimedOutActivity} =
  proxyActivities<ReturnType<typeof createOrchestrationActivities>>({
    startToCloseTimeout: '30s',
  });

const JOB_MAX_DURATION = '60 minutes';

export const jobCompletedSignal =
  defineSignal<[{status: CompletionStatus; output?: unknown}]>('job-completed');

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
  output?: unknown;
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

  let signalPayload: {status: CompletionStatus; output?: unknown} | undefined;

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
    const {status, output} = signalPayload;

    const {newVersion: finalVersion} = await setJobStatus({
      jobId: input.jobId,
      status,
      version: runningVersion,
    });

    await bulkSetStepStatuses({jobId: input.jobId, status});

    return {status, jobVersion: finalVersion, output};
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

  return {status: 'failed', jobVersion: finalVersion, output: {reason: 'job_timeout'}};
}
