import type {RunnerJobExecutionPlacementDeniedEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {JOB_PLACEMENT_DENIED_SIGNAL} from '#temporal/constants.js';
import {isWorkflowNotFound} from '#temporal/workflow-not-found.js';

// The runners poll removed the pending execution because its workspace may not use any runner
// that could serve it. Wake the job workflow so it fails the execution with the notice.
export async function onRunnerJobExecutionPlacementDenied(
  payload: RunnerJobExecutionPlacementDeniedEvent,
): Promise<void> {
  logger().info(
    {
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      jobId: payload.jobId,
      jobExecutionId: payload.jobExecutionId,
      noticeReason: payload.notice.reason,
    },
    'Signaling job orchestration of placement denial',
  );
  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  try {
    await handle.signal(JOB_PLACEMENT_DENIED_SIGNAL, {
      jobExecutionId: payload.jobExecutionId,
      notice: payload.notice,
    });
  } catch (err) {
    // The workflow already reached a terminal state; its status is authoritative.
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {jobId: payload.jobId, jobExecutionId: payload.jobExecutionId},
        'Job workflow already terminated; placement denial discarded',
      );
      return;
    }
    throw err;
  }
}
