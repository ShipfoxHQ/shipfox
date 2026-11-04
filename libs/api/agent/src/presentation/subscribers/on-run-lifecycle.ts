import type {
  WorkflowsJobActivatedEventDto,
  WorkflowsJobTerminatedEventDto,
  WorkflowsWorkflowRunTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {deliverRunResults, type RunDeliveryWorkflows} from '#core/deliver-run-results.js';
import {requestRunLinkChecks} from '#db/run-links.js';

type RunLifecycleEvent =
  | WorkflowsJobActivatedEventDto
  | WorkflowsJobTerminatedEventDto
  | WorkflowsWorkflowRunTerminatedEventDto;

/**
 * A job activated or ended, or a run attempt ended, so a conversation that started the run may
 * have a result to receive. The request is one indexed update, and most runs have no link. It is
 * the only step that can fail the event, and it touches only Postgres, which also holds the
 * outbox. The check that follows runs at once, and a failure is logged because the sweep runs
 * the requested check again.
 */
export function createOnRunLifecycle(deps: {
  workflows: RunDeliveryWorkflows;
  wake: (conversationId: string) => Promise<void>;
}) {
  return async (payload: RunLifecycleEvent): Promise<void> => {
    const linked = await requestRunLinkChecks(payload.workflowRunId);
    if (linked === 0) return;

    try {
      await deliverRunResults({
        workflowRunId: payload.workflowRunId,
        workflows: deps.workflows,
        wake: deps.wake,
      });
    } catch (error) {
      logger().warn(
        {err: error, workflowRunId: payload.workflowRunId},
        'Failed to check a workflow run for delivery to its conversations',
      );
    }
  };
}
