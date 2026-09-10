import type {
  StepAttemptTerminalCauseDto,
  WorkflowsJobTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {config} from '#config.js';
import {LOGS_LIFECYCLE_TASK_QUEUE} from '#temporal/constants.js';

/**
 * A job reached a terminal state (any path: completion, cancellation, lease-expiry,
 * timeout). Arm the grace-then-close workflow for any of its streams the runner never
 * ended itself. Deduped by workflow id, so a redelivered event is a no-op.
 */
export async function onJobTerminated(payload: WorkflowsJobTerminatedEventDto): Promise<void> {
  try {
    await temporalClient().workflow.start('closeAbandonedStreams', {
      taskQueue: LOGS_LIFECYCLE_TASK_QUEUE,
      workflowId: `logs-close:${payload.jobId}`,
      args: [
        {
          jobId: payload.jobId,
          graceSeconds: config.LOG_STREAM_CLOSE_GRACE_SECONDS,
          terminalCause: terminalCauseForJob(payload),
        },
      ],
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'WorkflowExecutionAlreadyStartedError') {
      logger().debug({jobId: payload.jobId}, 'Close-abandoned-streams workflow already started');
      return;
    }
    throw error;
  }
}

function terminalCauseForJob(
  payload: WorkflowsJobTerminatedEventDto,
): StepAttemptTerminalCauseDto | null {
  if (payload.statusReason === 'timed_out') return 'timed_out';
  if (payload.statusReason === 'run_cancelled' || payload.statusReason === 'user_cancelled') {
    return 'run_cancelled';
  }
  if (
    payload.statusReason === 'runner_lost' ||
    payload.statusReason === 'lease_expired' ||
    payload.statusReason === 'provider_lost' ||
    payload.statusReason === 'lifecycle_violation'
  ) {
    return 'runner_lost';
  }
  return null;
}
