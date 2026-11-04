import type {DefinitionResolvedEvent} from '@shipfox/api-definitions-dto';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {projectDefinitionTriggers} from '#db/subscriptions.js';

export async function onDefinitionResolved(payload: DefinitionResolvedEvent): Promise<void> {
  try {
    await projectDefinitionTriggers({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      workflowDefinitionId: payload.definitionId,
      triggers: payload.triggers,
    });
  } catch (error) {
    // The project was deleted after the event was queued, so there is nothing to project.
    if (error instanceof ScopeDeletedError) return;
    throw error;
  }
}
