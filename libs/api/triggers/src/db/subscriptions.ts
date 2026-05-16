import type {TriggerDto} from '@shipfox/api-definitions-dto';
import {and, eq, inArray, notInArray} from 'drizzle-orm';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {db} from './db.js';
import {toTriggerSubscription, triggerSubscriptions} from './schema/subscriptions.js';

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0];
type Executor = ReturnType<typeof db> | Tx;

export interface ProjectDefinitionTriggersParams {
  tx?: Tx | undefined;
  workspaceId: string;
  projectId: string;
  workflowDefinitionId: string;
  triggers: Record<string, TriggerDto>;
}

export async function projectDefinitionTriggers(
  params: ProjectDefinitionTriggersParams,
): Promise<void> {
  const work = async (tx: Tx): Promise<void> => {
    const entries = Object.entries(params.triggers);
    const keepNames = entries.map(([name]) => name);

    if (keepNames.length === 0) {
      await tx
        .delete(triggerSubscriptions)
        .where(eq(triggerSubscriptions.workflowDefinitionId, params.workflowDefinitionId));
      return;
    }

    await tx
      .delete(triggerSubscriptions)
      .where(
        and(
          eq(triggerSubscriptions.workflowDefinitionId, params.workflowDefinitionId),
          notInArray(triggerSubscriptions.name, keepNames),
        ),
      );

    for (const [name, trigger] of entries) {
      const config: Record<string, unknown> = {};
      if (trigger.on !== undefined) config.on = trigger.on;
      if (trigger.with !== undefined) config.with = trigger.with;
      if (trigger.filter !== undefined) config.filter = trigger.filter;

      await tx
        .insert(triggerSubscriptions)
        .values({
          workspaceId: params.workspaceId,
          projectId: params.projectId,
          workflowDefinitionId: params.workflowDefinitionId,
          name,
          source: trigger.source,
          event: trigger.event,
          config,
        })
        .onConflictDoUpdate({
          target: [triggerSubscriptions.workflowDefinitionId, triggerSubscriptions.name],
          set: {
            workspaceId: params.workspaceId,
            projectId: params.projectId,
            source: trigger.source,
            event: trigger.event,
            config,
            updatedAt: new Date(),
          },
        });
    }
  };

  if (params.tx) {
    await work(params.tx);
    return;
  }
  await db().transaction(work);
}

export interface DeleteSubscriptionsForDefinitionParams {
  tx?: Tx | undefined;
  workflowDefinitionId: string;
}

export async function deleteSubscriptionsForDefinition(
  params: DeleteSubscriptionsForDefinitionParams,
): Promise<number> {
  const work = async (executor: Executor): Promise<number> => {
    const rows = await executor
      .delete(triggerSubscriptions)
      .where(eq(triggerSubscriptions.workflowDefinitionId, params.workflowDefinitionId))
      .returning({id: triggerSubscriptions.id});
    return rows.length;
  };
  if (params.tx) return await work(params.tx);
  return await db().transaction(work);
}

export async function getTriggerSubscriptionById(
  id: string,
): Promise<TriggerSubscription | undefined> {
  const rows = await db()
    .select()
    .from(triggerSubscriptions)
    .where(eq(triggerSubscriptions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toTriggerSubscription(row);
}

export async function getManualSubscriptionByDefinitionId(
  workflowDefinitionId: string,
): Promise<TriggerSubscription | undefined> {
  // limit(2) catches a broken parser invariant (>1 manual per definition) loudly instead of silently picking one.
  const rows = await db()
    .select()
    .from(triggerSubscriptions)
    .where(
      and(
        eq(triggerSubscriptions.workflowDefinitionId, workflowDefinitionId),
        eq(triggerSubscriptions.source, 'manual'),
      ),
    )
    .limit(2);
  if (rows.length > 1) {
    throw new Error(
      `Workflow definition ${workflowDefinitionId} has ${rows.length} manual triggers; expected at most 1`,
    );
  }
  const row = rows[0];
  if (!row) return undefined;
  return toTriggerSubscription(row);
}

export interface FindMatchingSubscriptionsParams {
  workspaceId: string;
  projectId: string;
  source: string;
  event: string;
}

export async function findMatchingSubscriptions(
  params: FindMatchingSubscriptionsParams,
): Promise<TriggerSubscription[]> {
  const rows = await db()
    .select()
    .from(triggerSubscriptions)
    .where(
      and(
        eq(triggerSubscriptions.workspaceId, params.workspaceId),
        eq(triggerSubscriptions.projectId, params.projectId),
        eq(triggerSubscriptions.source, params.source),
        eq(triggerSubscriptions.event, params.event),
      ),
    );
  return rows.map(toTriggerSubscription);
}

export async function listSubscriptionsByWorkflowDefinitionIds(
  workflowDefinitionIds: string[],
): Promise<TriggerSubscription[]> {
  if (workflowDefinitionIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(triggerSubscriptions)
    .where(inArray(triggerSubscriptions.workflowDefinitionId, workflowDefinitionIds));
  return rows.map(toTriggerSubscription);
}
