import {runWorkflow} from '@shipfox/api-workflows';
import {findMatchingSubscriptions} from '#db/subscriptions.js';
import {readConfigInputs} from './config.js';
import {beginTriggerHistory, toReason} from './record-trigger-history.js';

export interface DispatchIntegrationEventParams {
  eventRef: string;
  workspaceId: string;
  source: string;
  event: string;
  deliveryId: string;
  connectionId: string;
  payload: unknown;
  receivedAt: Date;
}

// Source-agnostic dispatcher: any inbound integration event fans out to every
// workspace subscription registered for its (source, event), passing the raw
// payload through untouched. The module knows nothing about github, gitlab, etc.
// History is best-effort, but `runWorkflow` errors still re-throw so the outbox retries.
// A transient failure converges to `routed` on replay; a permanent one (e.g. a deleted
// definition) re-throws every retry, so the event stays `failed`. The recorded outcome
// tracks reality; it is not a stuck state to recover from here.
export async function dispatchIntegrationEvent(
  params: DispatchIntegrationEventParams,
): Promise<void> {
  const history = await beginTriggerHistory({
    eventRef: params.eventRef,
    origin: 'integration',
    workspaceId: params.workspaceId,
    source: params.source,
    event: params.event,
    deliveryId: params.deliveryId,
    connectionId: params.connectionId,
    payload: (params.payload ?? null) as Record<string, unknown> | null,
    receivedAt: params.receivedAt,
  });

  const subscriptions = await findMatchingSubscriptions({
    workspaceId: params.workspaceId,
    source: params.source,
    event: params.event,
  });

  if (subscriptions.length === 0) {
    await history.discarded();
    return;
  }

  for (const subscription of subscriptions) {
    try {
      const run = await runWorkflow({
        workspaceId: subscription.workspaceId,
        projectId: subscription.projectId,
        definitionId: subscription.workflowDefinitionId,
        triggerPayload: {
          source: params.source,
          event: params.event,
          deliveryId: params.deliveryId,
          data: params.payload,
        },
        inputs: readConfigInputs(subscription),
        triggerIdempotencyKey: `${subscription.id}:${params.eventRef}`,
      });
      await history.triggered(subscription, run);
    } catch (error) {
      await history.errored(subscription, toReason(error));
      await history.failed(subscriptions.length);
      throw error;
    }
  }

  await history.routed(subscriptions.length);
}
