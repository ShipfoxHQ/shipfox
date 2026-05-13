import {Factory} from 'fishery';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {db} from '#db/db.js';
import {toTriggerSubscription, triggerSubscriptions} from '#db/schema/subscriptions.js';

export const triggerSubscriptionFactory = Factory.define<TriggerSubscription>(
  ({sequence, onCreate}) => {
    onCreate(async (subscription) => {
      const [row] = await db()
        .insert(triggerSubscriptions)
        .values({
          workspaceId: subscription.workspaceId,
          projectId: subscription.projectId,
          workflowDefinitionId: subscription.workflowDefinitionId,
          name: subscription.name,
          source: subscription.source,
          event: subscription.event,
          config: subscription.config,
        })
        .returning();
      if (!row) throw new Error('Insert returned no rows');
      return toTriggerSubscription(row);
    });

    return {
      id: crypto.randomUUID(),
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowDefinitionId: crypto.randomUUID(),
      name: `trigger_${sequence}`,
      source: 'manual',
      event: 'fire',
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  },
);
