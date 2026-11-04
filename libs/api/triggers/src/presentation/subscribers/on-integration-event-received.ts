import type {IntegrationEventReceivedEvent} from '@shipfox/api-integration-core-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {DomainEvent} from '@shipfox/node-outbox';
import {dispatchIntegrationEvent} from '#core/dispatch-integration-event.js';
import type {AgentRoutingClient, AgentRoutingIntegrations} from '#core/route-event-to-agent.js';

export function createOnIntegrationEventReceived(
  workflows: WorkflowsModuleClient,
  secrets?: Pick<SecretsInterModuleClient, 'getSecret'>,
  agentRouting?: {integrations: AgentRoutingIntegrations; agent: AgentRoutingClient},
  projects?: Pick<ProjectsModuleClient, 'getProjectAccessPolicies'>,
) {
  return async function onIntegrationEventReceived(
    envelope: IntegrationEventReceivedEvent,
    event: DomainEvent<IntegrationEventReceivedEvent>,
  ): Promise<void> {
    await dispatchIntegrationEvent({
      workflows,
      secrets,
      projects,
      integrations: agentRouting?.integrations,
      agent: agentRouting?.agent,
      eventRef: event.id,
      workspaceId: envelope.workspaceId,
      provider: envelope.provider,
      source: envelope.source,
      event: envelope.event,
      deliveryId: envelope.deliveryId,
      connectionId: envelope.connectionId,
      connectionName: envelope.connectionName ?? null,
      resource: envelope.resource ?? null,
      payload: envelope.payload,
      receivedAt: new Date(envelope.receivedAt),
    });
  };
}
