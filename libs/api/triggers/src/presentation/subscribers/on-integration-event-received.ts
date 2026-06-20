import type {IntegrationEventReceivedEvent} from '@shipfox/api-integration-core-dto';
import {runWorkflow} from '@shipfox/api-workflows';
import type {DomainEvent} from '@shipfox/node-outbox';
import {readConfigInputs} from '#core/config.js';
import {beginTriggerHistory, toReason} from '#core/record-trigger-history.js';
import {findMatchingSubscriptions} from '#db/subscriptions.js';

// Source-agnostic dispatcher: any inbound integration event fans out to every
// workspace subscription registered for its (source, event), passing the raw
// payload through untouched. The module knows nothing about github, gitlab, etc.
// History is best-effort, but `runWorkflow` errors still re-throw so the outbox retries.
// A transient failure converges to `routed` on replay; a permanent one (e.g. a deleted
// definition) re-throws every retry, so the event stays `failed` — the recorded outcome
// tracking reality, not a stuck state to recover from here.
export async function onIntegrationEventReceived(
  envelope: IntegrationEventReceivedEvent,
  event: DomainEvent<IntegrationEventReceivedEvent>,
): Promise<void> {
  const history = await beginTriggerHistory({
    eventRef: event.id,
    origin: 'integration',
    workspaceId: envelope.workspaceId,
    source: envelope.source,
    event: envelope.event,
    deliveryId: envelope.deliveryId,
    connectionId: envelope.connectionId,
    payload: (envelope.payload ?? null) as Record<string, unknown> | null,
    receivedAt: new Date(envelope.receivedAt),
  });

  const subscriptions = await findMatchingSubscriptions({
    workspaceId: envelope.workspaceId,
    source: envelope.source,
    event: envelope.event,
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
          source: envelope.source,
          event: envelope.event,
          deliveryId: envelope.deliveryId,
          data: envelope.payload,
        },
        inputs: readConfigInputs(subscription),
        triggerIdempotencyKey: `${subscription.id}:${event.id}`,
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
