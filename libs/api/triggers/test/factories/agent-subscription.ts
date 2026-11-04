import {Factory} from 'fishery';
import type {AgentSubscription} from '#core/entities/agent-subscription.js';
import {db} from '#db/db.js';
import {agentSubscriptions, toAgentSubscription} from '#db/schema/agent-subscriptions.js';

export const agentSubscriptionFactory = Factory.define<AgentSubscription>(
  ({sequence, onCreate}) => {
    onCreate(async (subscription) => {
      const [row] = await db()
        .insert(agentSubscriptions)
        .values({
          workspaceId: subscription.workspaceId,
          projectId: subscription.projectId,
          agentKey: subscription.agentKey,
          source: subscription.source,
          filter: subscription.filter,
          createdAt: subscription.createdAt,
        })
        .returning();
      if (!row) throw new Error('Insert returned no rows');
      return toAgentSubscription(row);
    });

    return {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      agentKey: `agent_${sequence}`,
      source: 'slack',
      filter: null,
      createdAt: new Date(),
    };
  },
);
