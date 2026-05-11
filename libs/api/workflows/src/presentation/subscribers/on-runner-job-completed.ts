import type {RunnerJobCompletedEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';

const WORKFLOW_NOT_FOUND = 'WorkflowNotFoundError';

function isWorkflowNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === WORKFLOW_NOT_FOUND;
}

export async function onRunnerJobCompleted(event: DomainEvent): Promise<void> {
  const payload = event.payload as RunnerJobCompletedEvent;
  logger().info({jobId: payload.jobId, status: payload.status}, 'Signaling job orchestration');
  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  try {
    await handle.signal('job-completed', {
      status: payload.status,
      steps: payload.steps,
    });
  } catch (err) {
    // Workflow already terminated (e.g. timeout path); its status is
    // authoritative, drop this late event.
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {jobId: payload.jobId, status: payload.status},
        'Job workflow already terminated; runner-completion event discarded',
      );
      return;
    }
    throw err;
  }
}
