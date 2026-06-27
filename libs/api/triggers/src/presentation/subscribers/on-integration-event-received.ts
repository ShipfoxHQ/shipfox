import type {IntegrationEventReceivedEvent} from '@shipfox/api-integration-core-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {dispatchIntegrationEvent} from '#core/dispatch-integration-event.js';

export async function onIntegrationEventReceived(
  envelope: IntegrationEventReceivedEvent,
  event: DomainEvent<IntegrationEventReceivedEvent>,
): Promise<void> {
  await dispatchIntegrationEvent({
    eventRef: event.id,
    workspaceId: envelope.workspaceId,
    source: envelope.source,
    event: envelope.event,
    deliveryId: envelope.deliveryId,
    connectionId: envelope.connectionId,
    connectionName: envelope.connectionName,
    payload: envelope.payload,
    receivedAt: new Date(envelope.receivedAt),
  });
}
