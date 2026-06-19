import type {DefinitionResolvedEvent} from '@shipfox/api-definitions-dto';
import {projectDefinitionTriggers} from '#db/subscriptions.js';

export async function onDefinitionResolved(payload: DefinitionResolvedEvent): Promise<void> {
  await projectDefinitionTriggers({
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
    workflowDefinitionId: payload.definitionId,
    triggers: payload.triggers,
  });
}
