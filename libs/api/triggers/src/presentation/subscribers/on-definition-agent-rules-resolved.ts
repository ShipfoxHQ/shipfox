import type {DefinitionAgentRulesResolvedEvent} from '@shipfox/api-definitions-dto';
import {ScopeDeletedError} from '@shipfox/node-drizzle';
import {projectAgentSubscriptions} from '#db/agent-subscriptions.js';

export async function onDefinitionAgentRulesResolved(
  payload: DefinitionAgentRulesResolvedEvent,
): Promise<void> {
  try {
    await projectAgentSubscriptions({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      agents: payload.agents,
    });
  } catch (error) {
    if (error instanceof ScopeDeletedError) return;
    throw error;
  }
}
