import type {RunnerJobLeaseExpiredEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';
import {JOB_LEASE_EXPIRED_SIGNAL} from '#temporal/constants.js';

const WORKFLOW_NOT_FOUND = 'WorkflowNotFoundError';

function isWorkflowNotFound(err: unknown): boolean {
  return err instanceof Error && err.name === WORKFLOW_NOT_FOUND;
}

// The stuck-job detector emits runners.job.lease_expired when a runner's heartbeat
// goes stale. Wake the job workflow so it resolves the outcome from authoritative
// server state (adopt the terminal status if the steps finished concurrently,
// otherwise fail the job and cancel the remaining steps).
export async function onRunnerJobLeaseExpired(event: DomainEvent): Promise<void> {
  const payload = event.payload as RunnerJobLeaseExpiredEvent;
  logger().info(
    {jobId: payload.jobId, runId: payload.runId},
    'Signaling job orchestration of lease expiry',
  );
  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  try {
    await handle.signal(JOB_LEASE_EXPIRED_SIGNAL);
  } catch (err) {
    // Workflow already terminated (it finished or hit the timeout backstop first);
    // its status is authoritative, drop this late event.
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {jobId: payload.jobId},
        'Job workflow already terminated; lease-expired event discarded',
      );
      return;
    }
    throw err;
  }
}
