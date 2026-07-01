import {deliverEventToListener, type JobListenerEventDisposition} from '@shipfox/api-workflows';
import {findMatchingJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';

export interface RouteEventToJobListenersParams {
  eventRef: string;
  workspaceId: string;
  provider: string;
  source: string;
  event: string;
  deliveryId: string;
  payload: unknown;
  receivedAt: Date;
}

export interface RouteEventToJobListenersResult {
  matchedJobCount: number;
  deliveredCount: number;
  transientErrored: boolean;
  transientError: unknown;
}

export async function routeEventToJobListeners(
  params: RouteEventToJobListenersParams,
): Promise<RouteEventToJobListenersResult> {
  const subscriptions = await findMatchingJobListenerSubscriptions({
    workspaceId: params.workspaceId,
    source: params.source,
    event: params.event,
  });

  const dispositionByJobId = new Map<string, JobListenerEventDisposition>();
  for (const subscription of subscriptions) {
    const previous = dispositionByJobId.get(subscription.jobId);
    if (previous === 'resolve') continue;
    dispositionByJobId.set(subscription.jobId, subscription.kind === 'until' ? 'resolve' : 'fire');
  }

  let deliveredCount = 0;
  let sawTransientError = false;
  let firstTransientError: unknown;

  for (const [jobId, disposition] of dispositionByJobId) {
    try {
      const result = await deliverEventToListener({
        jobId,
        disposition,
        eventRef: params.eventRef,
        deliveryId: params.deliveryId,
        source: params.source,
        event: params.event,
        provider: params.provider,
        payload: params.payload,
        receivedAt: params.receivedAt,
      });
      if (result.buffered) deliveredCount += 1;
    } catch (error) {
      if (!sawTransientError) {
        sawTransientError = true;
        firstTransientError = error;
      }
    }
  }

  return {
    matchedJobCount: dispositionByJobId.size,
    deliveredCount,
    transientErrored: sawTransientError,
    transientError: sawTransientError ? firstTransientError : undefined,
  };
}
