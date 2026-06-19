import type {DefinitionResolvedEvent} from '@shipfox/api-definitions-dto';
import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggerSubscriptions} from '#db/schema/subscriptions.js';
import {triggerSubscriptionFactory} from '#test/index.js';
import {onDefinitionResolved} from './on-definition-resolved.js';

function buildPayload(overrides: Partial<DefinitionResolvedEvent> = {}): DefinitionResolvedEvent {
  return {
    definitionId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    configPath: '.shipfox/workflow.yml',
    triggers: {onPush: {source: 'github', event: 'push'}},
    ...overrides,
  };
}

function listSubscriptions(workflowDefinitionId: string) {
  return db()
    .select()
    .from(triggerSubscriptions)
    .where(eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId));
}

describe('onDefinitionResolved', () => {
  it('persists a subscription for each declared trigger', async () => {
    const payload = buildPayload({
      triggers: {
        onPush: {source: 'github', event: 'push', with: {env: 'staging'}},
        onManual: {source: 'manual', event: 'fire'},
      },
    });

    await onDefinitionResolved(payload);

    const rows = await listSubscriptions(payload.definitionId);
    expect(rows.map((r) => r.name).sort()).toEqual(['onManual', 'onPush']);
    expect(rows.find((r) => r.name === 'onPush')?.config).toEqual({with: {env: 'staging'}});
  });

  it('removes subscriptions whose trigger is no longer declared', async () => {
    const workflowDefinitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workflowDefinitionId, name: 'onPush'});
    await triggerSubscriptionFactory.create({workflowDefinitionId, name: 'stale'});

    await onDefinitionResolved(
      buildPayload({
        definitionId: workflowDefinitionId,
        triggers: {onPush: {source: 'github', event: 'push'}},
      }),
    );

    const rows = await listSubscriptions(workflowDefinitionId);
    expect(rows.map((r) => r.name)).toEqual(['onPush']);
  });

  it('clears every subscription when the definition declares no triggers', async () => {
    const workflowDefinitionId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({workflowDefinitionId, name: 'onPush'});

    await onDefinitionResolved(buildPayload({definitionId: workflowDefinitionId, triggers: {}}));

    const rows = await listSubscriptions(workflowDefinitionId);
    expect(rows).toHaveLength(0);
  });
});
