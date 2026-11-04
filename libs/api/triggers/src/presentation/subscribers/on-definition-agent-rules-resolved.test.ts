import type {DefinitionAgentRulesResolvedEvent} from '@shipfox/api-definitions-dto';
import {listAgentSubscriptionsByProject} from '#db/agent-subscriptions.js';
import {onDefinitionAgentRulesResolved} from './on-definition-agent-rules-resolved.js';

function buildPayload(
  overrides: Partial<DefinitionAgentRulesResolvedEvent> = {},
): DefinitionAgentRulesResolvedEvent {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    agents: [{key: 'payments', rules: [{source: 'slack', filter: 'request.channel_id == "C1"'}]}],
    ...overrides,
  };
}

describe('onDefinitionAgentRulesResolved', () => {
  it('stores a subscription for each rule', async () => {
    const payload = buildPayload();

    await onDefinitionAgentRulesResolved(payload);

    const rows = await listAgentSubscriptionsByProject(payload.projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: payload.workspaceId,
      agentKey: 'payments',
      source: 'slack',
      filter: 'request.channel_id == "C1"',
    });
  });

  it('removes the subscriptions of a project whose agents lost their rules', async () => {
    const payload = buildPayload();
    await onDefinitionAgentRulesResolved(payload);

    await onDefinitionAgentRulesResolved({...payload, agents: []});

    expect(await listAgentSubscriptionsByProject(payload.projectId)).toEqual([]);
  });
});
