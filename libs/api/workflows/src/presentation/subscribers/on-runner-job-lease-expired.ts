import type {RunnerJobLeaseExpiredEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {JOB_LEASE_EXPIRED_SIGNAL} from '#temporal/constants.js';
import {isWorkflowNotFound} from '#temporal/workflow-not-found.js';

// The stuck-job detector emits runners.job.lease_expired when a runner's heartbeat
// goes stale. Wake the job workflow so it resolves the outcome from authoritative
// server state (adopt the terminal status if the steps finished concurrently,
// otherwise fail the job and cancel the remaining steps).
export async function onRunnerJobLeaseExpired(payload: RunnerJobLeaseExpiredEvent): Promise<void> {
  logger().info(
    {jobId: payload.jobId, executionId: payload.executionId ?? payload.jobId, runId: payload.runId},
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
        {jobId: payload.jobId, executionId: payload.executionId ?? payload.jobId},
        'Job workflow already terminated; lease-expired event discarded',
      );
      return;
    }
    throw err;
  }
}
