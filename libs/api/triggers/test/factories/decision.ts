import {Factory} from 'fishery';
import type {TriggerDecision} from '#core/entities/decision.js';
import {db} from '#db/db.js';
import {toTriggerDecision, triggersDecisions} from '#db/schema/decisions.js';

export const decisionFactory = Factory.define<TriggerDecision>(({onCreate}) => {
  onCreate(async (decision) => {
    const [row] = await db()
      .insert(triggersDecisions)
      .values({
        receivedEventId: decision.receivedEventId,
        subscriptionId: decision.subscriptionId,
        workflowDefinitionId: decision.workflowDefinitionId,
        projectId: decision.projectId,
        decision: decision.decision,
        runId: decision.runId,
        runName: decision.runName,
        reason: decision.reason,
      })
      .returning();
    if (!row) throw new Error('Insert returned no rows');
    return toTriggerDecision(row);
  });

  return {
    id: crypto.randomUUID(),
    receivedEventId: crypto.randomUUID(),
    subscriptionId: crypto.randomUUID(),
    workflowDefinitionId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    decision: 'triggered',
    runId: crypto.randomUUID(),
    runName: 'deploy',
    reason: null,
    createdAt: new Date(),
  };
});
