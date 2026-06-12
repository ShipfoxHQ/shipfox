import type {WorkflowsJobCompletedEvent} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';
import {JOB_FINISHED_SIGNAL} from '#temporal/constants.js';

const WORKFLOW_NOT_FOUND = 'WorkflowNotFoundError';

function isWorkflowNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === WORKFLOW_NOT_FOUND;
}

// Per-step execution finishes a job inside recordStepResult (no runner /complete
// call), which enqueues WORKFLOWS_JOB_COMPLETED in the same transaction. The
// persisted per-step projection is already terminal, so the workflow only flips
// the job status — no steps are carried.
export async function onJobCompleted(event: DomainEvent): Promise<void> {
  const payload = event.payload as WorkflowsJobCompletedEvent;
  logger().info({jobId: payload.jobId, status: payload.status}, 'Signaling job finished');
  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  try {
    await handle.signal(JOB_FINISHED_SIGNAL, {status: payload.status});
  } catch (err) {
    // Workflow already terminated (e.g. timeout path); its status is
    // authoritative, drop this late event.
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {jobId: payload.jobId, status: payload.status},
        'Job workflow already terminated; job-finished event discarded',
      );
      return;
    }
    throw err;
  }
}
