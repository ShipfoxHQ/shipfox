import type {IntegrationEventReceivedEvent} from '@shipfox/api-integration-core-dto';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {DomainEvent} from '@shipfox/node-outbox';
import {dispatchIntegrationEvent} from '#core/dispatch-integration-event.js';

export function createOnIntegrationEventReceived(
  workflows: WorkflowsModuleClient,
  secrets?: Pick<SecretsInterModuleClient, 'getSecret'>,
) {
  return async function onIntegrationEventReceived(
    envelope: IntegrationEventReceivedEvent,
    event: DomainEvent<IntegrationEventReceivedEvent>,
  ): Promise<void> {
    await dispatchIntegrationEvent({
      workflows,
      secrets,
      eventRef: event.id,
      workspaceId: envelope.workspaceId,
      provider: envelope.provider,
      source: envelope.source,
      event: envelope.event,
      deliveryId: envelope.deliveryId,
      connectionId: envelope.connectionId,
      connectionName: envelope.connectionName ?? null,
      payload: envelope.payload,
      receivedAt: new Date(envelope.receivedAt),
    });
  };
}
