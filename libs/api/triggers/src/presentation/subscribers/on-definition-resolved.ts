import type {DefinitionResolvedEvent} from '@shipfox/api-definitions-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {projectDefinitionTriggers} from '#db/subscriptions.js';

export async function onDefinitionResolved(event: DomainEvent): Promise<void> {
  const payload = event.payload as DefinitionResolvedEvent;

  await projectDefinitionTriggers({
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
    workflowDefinitionId: payload.definitionId,
    triggers: payload.triggers,
  });
}
