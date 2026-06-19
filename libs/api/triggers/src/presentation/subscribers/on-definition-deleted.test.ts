import type {DefinitionDeletedEvent} from '@shipfox/api-definitions-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggerSubscriptions} from '#db/schema/subscriptions.js';
import {triggerSubscriptionFactory} from '#test/index.js';
import {onDefinitionDeleted} from './on-definition-deleted.js';

function buildPayload(definitionId: string): DefinitionDeletedEvent {
  return {definitionId, projectId: crypto.randomUUID(), workspaceId: crypto.randomUUID()};
}

function listSubscriptions(workflowDefinitionId: string) {
  return db()
    .select()
    .from(triggerSubscriptions)
    .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));
}

describe('onDefinitionDeleted', () => {
  it('deletes every subscription for the definition', async () => {
    const definitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workflowDefinitionId: definitionId, name: 'a'});
    await triggerSubscriptionFactory.create({workflowDefinitionId: definitionId, name: 'b'});

    await onDefinitionDeleted(buildPayload(definitionId));

    const rows = await listSubscriptions(definitionId);
    expect(rows).toHaveLength(0);
  });

  it('leaves subscriptions for other definitions untouched', async () => {
    const deletedId = crypto.randomUUID();
    const keptId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workflowDefinitionId: deletedId, name: 'a'});
    const kept = await triggerSubscriptionFactory.create({workflowDefinitionId: keptId, name: 'a'});

    await onDefinitionDeleted(buildPayload(deletedId));

    const rows = await listSubscriptions(keptId);
    expect(rows.map((r) => r.id)).toEqual([kept.id]);
  });
});
