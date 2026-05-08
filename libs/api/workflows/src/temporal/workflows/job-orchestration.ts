import {condition, defineSignal, log, proxyActivities, setHandler} from '@temporalio/workflow';

import type {CompletionStatus} from '#core/dag.js';

import type {createOrchestrationActivities} from '../activities/index.js';

/**
 * Three terminal paths for a single job orchestration:
 *
 *   ┌─ runner POST /complete arrives ──► signal payload set
 *   │                                     ▼
 *   │                                  status = signalPayload.status
 *   │                                  output = signalPayload.output
 *   │
 *   ├─ JOB_MAX_DURATION elapses with no signal ──► condition() returns false
 *   │                                               ▼
 *   │                                            requestJobCancellationActivity (best-effort,
 *   │                                              maximumAttempts:1, scheduleToClose:10s)
 *   │                                               ▼
 *   │                                            status = 'failed'
 *   │                                            output = { reason: 'job_timeout' }
 *   │
 *   └─ cancellation activity throws ──► caught; log.warn (workflow-side, deterministic)
 *                                        ▼
 *                                       status = 'failed' (same as above)
 *
 * In all paths: setJobStatus(status) → bulkSetStepStatuses(status) → return.
 */

const {setJobStatus, enqueueJobForRunner, bulkSetStepStatuses} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '30s',
});

// Cancellation is best-effort; the stuck-job detector is the safety net. Bound
// retries explicitly so a DB outage cannot block the failure path. With Temporal's
// default retries the catch below would fire many minutes after the timeout.
const {requestJobCancellationActivity} = proxyActivities<
  ReturnType<typeof createOrchestrationActivities>
>({
  startToCloseTimeout: '5s',
  scheduleToCloseTimeout: '10s',
  retry: {maximumAttempts: 1},
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

  let status: CompletionStatus;
  let output: unknown;

  if (completed) {
    if (!signalPayload) {
      throw new Error('Unreachable: condition() returned true so signalPayload is set');
    }
    ({status, output} = signalPayload);
  } else {
    try {
      await requestJobCancellationActivity({jobId: input.jobId});
    } catch (err) {
      log.warn('requestJobCancellationActivity failed; proceeding to fail job', {
        jobId: input.jobId,
        err: String(err),
      });
    }
    status = 'failed';
    output = {reason: 'job_timeout'};
  }

  const {newVersion: finalVersion} = await setJobStatus({
    jobId: input.jobId,
    status,
    version: runningVersion,
  });

  await bulkSetStepStatuses({
    jobId: input.jobId,
    status,
  });

  return {status, jobVersion: finalVersion, output};
}
