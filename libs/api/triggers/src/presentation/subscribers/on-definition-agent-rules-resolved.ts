import type {DefinitionAgentRulesResolvedEvent} from '@shipfox/api-definitions-dto';
import {projectAgentSubscriptions} from '#db/agent-subscriptions.js';

export async function onDefinitionAgentRulesResolved(
  payload: DefinitionAgentRulesResolvedEvent,
): Promise<void> {
  await projectAgentSubscriptions({
    workspaceId: payload.workspaceId,
    projectId: payload.projectId,
    agents: payload.agents,
  });
}
