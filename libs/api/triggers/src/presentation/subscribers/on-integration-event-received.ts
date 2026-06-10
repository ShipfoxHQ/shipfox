import type {IntegrationEventReceivedEvent} from '@shipfox/api-integration-core-dto';
import {runWorkflow} from '@shipfox/api-workflows';
import type {DomainEvent} from '@shipfox/node-outbox';
import {readConfigInputs} from '#core/config.js';
import {findMatchingSubscriptions} from '#db/subscriptions.js';

// Source-agnostic dispatcher: any inbound integration event fans out to every
// workspace subscription registered for its (source, event), passing the raw
// payload through untouched. The module knows nothing about github, gitlab, etc.
export async function onIntegrationEventReceived(event: DomainEvent): Promise<void> {
  const envelope = event.payload as IntegrationEventReceivedEvent;

  const subscriptions = await findMatchingSubscriptions({
    workspaceId: envelope.workspaceId,
    source: envelope.source,
    event: envelope.event,
  });

  for (const subscription of subscriptions) {
    await runWorkflow({
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
  }
}
