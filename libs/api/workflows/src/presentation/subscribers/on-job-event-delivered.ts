import type {WorkflowsJobEventDeliveredEventDto} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {temporalClient} from '@shipfox/node-temporal';
import {LISTENER_EVENTS_AVAILABLE_SIGNAL, LISTENER_RESOLVE_SIGNAL} from '#temporal/constants.js';
import {isWorkflowNotFound} from '#temporal/workflow-not-found.js';

export async function onJobEventDelivered(
  payload: WorkflowsJobEventDeliveredEventDto,
): Promise<void> {
  const signal =
    payload.disposition === 'resolve' ? LISTENER_RESOLVE_SIGNAL : LISTENER_EVENTS_AVAILABLE_SIGNAL;
  const handle = temporalClient().workflow.getHandle(`job-listener:${payload.jobId}`);
  try {
    await handle.signal(signal);
  } catch (err) {
    if (isWorkflowNotFound(err)) {
      logger().debug(
        {
          jobId: payload.jobId,
          disposition: payload.disposition,
          eventRef: payload.eventRef,
          eventName: payload.eventName,
        },
        'Listener workflow already terminated; delivered event discarded',
      );
      return;
    }
    throw err;
  }
}
