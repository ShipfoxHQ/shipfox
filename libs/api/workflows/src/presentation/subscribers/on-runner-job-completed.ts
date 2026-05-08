import type {RunnerJobCompletedEvent} from '@shipfox/api-runners-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {DomainEvent} from '@shipfox/node-outbox';
import {temporalClient} from '@shipfox/node-temporal';

/**
 * Backend-determined terminal state wins (codex F8).
 *
 * If `jobOrchestration` already terminated via timeout (or via a prior runner
 * completion), signaling the workflow handle throws `WorkflowNotFoundError` from
 * `@temporalio/common`. We swallow it intentionally — a runner-reported success
 * arriving after the workflow has declared the job failed cannot retroactively
 * change the system-of-record state. The runner-side log of the run still shows
 * what the runner thought, for forensics.
 *
 * Match by `error.name` rather than `instanceof` to keep this subscriber free of
 * a direct `@temporalio/common` dependency and resilient across SDK minor versions.
 */
export async function onRunnerJobCompleted(event: DomainEvent): Promise<void> {
  const payload = event.payload as RunnerJobCompletedEvent;
  logger().info({jobId: payload.jobId, status: payload.status}, 'Signaling job orchestration');
  const handle = temporalClient().workflow.getHandle(`job:${payload.jobId}`);
  try {
    await handle.signal('job-completed', {
      status: payload.status,
      output: payload.output,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'WorkflowNotFoundError') {
      logger().debug(
        {jobId: payload.jobId, status: payload.status},
        'Job workflow already terminated; runner-completion event discarded (timeout-wins policy)',
      );
      return;
    }
    throw err;
  }
}
