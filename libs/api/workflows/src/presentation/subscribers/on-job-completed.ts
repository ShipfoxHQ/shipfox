import type {WorkflowsJobCompletedEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';

const WORKFLOW_NOT_FOUND = 'WorkflowNotFoundError';

function isWorkflowNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === WORKFLOW_NOT_FOUND;
}

// Per-step execution finishes a job inside recordStepResult (no runner
// /complete call), which enqueues WORKFLOWS_JOB_COMPLETED in the same
// transaction. This signals the job workflow that the persisted per-step state
// is already terminal. Steps are empty: the DB projection is authoritative, so
// the workflow only flips the job status — it does not re-apply step results.
export async function onJobCompleted(event: DomainEvent): Promise<void> {
  const payload = event.payload as WorkflowsJobCompletedEvent;
  logger().info({jobId: payload.jobId, status: payload.status}, 'Signaling job orchestration');
  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  try {
    await handle.signal('job-completed', {status: payload.status, steps: []});
  } catch (err) {
    // Workflow already terminated (e.g. timeout path); its status is
    // authoritative, drop this late event.
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {jobId: payload.jobId, status: payload.status},
        'Job workflow already terminated; job-completed event discarded',
      );
      return;
    }
    throw err;
  }
}
