import {and, eq, ne, notInArray, sql} from 'drizzle-orm';
import type {TriggerEventOrigin} from '#core/entities/received-event.js';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {db} from './db.js';
import {triggersDecisions} from './schema/decisions.js';
import {triggersReceivedEvents} from './schema/received-events.js';

export interface InsertReceivedEventParams {
  eventRef: string;
  origin: TriggerEventOrigin;
  workspaceId: string;
  provider: string | null;
  source: string;
  event: string;
  deliveryId: string | null;
  connectionId: string | null;
  connectionName: string | null;
  payload: Record<string, unknown> | null;
  receivedAt: Date;
}

// `event_ref` is unique and delivery is at-least-once, so the same event can
// arrive twice; either path returns the row id used to attach decisions.
export async function insertReceivedEvent(params: InsertReceivedEventParams): Promise<string> {
  const [inserted] = await db()
    .insert(triggersReceivedEvents)
    .values({
      eventRef: params.eventRef,
      origin: params.origin,
      workspaceId: params.workspaceId,
      provider: params.provider,
      source: params.source,
      event: params.event,
      deliveryId: params.deliveryId,
      connectionId: params.connectionId,
      connectionName: params.connectionName,
      payload: params.payload,
      receivedAt: params.receivedAt,
    })
    .onConflictDoNothing({target: triggersReceivedEvents.eventRef})
    .returning({id: triggersReceivedEvents.id});
  if (inserted) return inserted.id;

  const [existing] = await db()
    .select({id: triggersReceivedEvents.id})
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.eventRef, params.eventRef));
  if (!existing) {
    throw new Error(`received_events row missing after conflict for event_ref ${params.eventRef}`);
  }
  return existing.id;
}

export async function markReceivedEventDiscarded(id: string): Promise<void> {
  await db()
    .update(triggersReceivedEvents)
    .set({outcome: 'discarded', matchedCount: 0, processedAt: new Date()})
    .where(
      and(
        eq(triggersReceivedEvents.id, id),
        notInArray(triggersReceivedEvents.outcome, ['routed', 'errored']),
      ),
    );
}

export async function markReceivedEventRouted(id: string, matchedCount: number): Promise<void> {
  await db()
    .update(triggersReceivedEvents)
    .set({outcome: 'routed', matchedCount, processedAt: new Date()})
    .where(eq(triggersReceivedEvents.id, id));
}

// No processedAt: `failed` is transient. Under at-least-once dispatch, a late
// failure must not clobber a sibling invocation's terminal outcome.
export async function markReceivedEventFailed(id: string, matchedCount: number): Promise<void> {
  await db()
    .update(triggersReceivedEvents)
    .set({outcome: 'failed', matchedCount})
    .where(
      and(
        eq(triggersReceivedEvents.id, id),
        notInArray(triggersReceivedEvents.outcome, ['routed', 'discarded', 'errored']),
      ),
    );
}

// Terminal outcome for a fan-out that produced no new run this pass. The CASE is a
// cross-attempt safety net: under at-least-once delivery a prior attempt may already have
// created a run (its decision row is `triggered`, which is never downgraded), so promote the
// event to `routed` rather than falsely record `errored`. Guarded so it never downgrades a
// terminal success.
export async function markReceivedEventErrored(id: string, matchedCount: number): Promise<void> {
  await db()
    .update(triggersReceivedEvents)
    .set({
      outcome: sql`CASE WHEN EXISTS (
        SELECT 1
        FROM ${triggersDecisions}
        WHERE ${triggersDecisions.receivedEventId} = ${triggersReceivedEvents.id}
          AND ${triggersDecisions.decision} = 'triggered'
      ) THEN 'routed' ELSE 'errored' END`,
      matchedCount,
      processedAt: new Date(),
    })
    .where(
      and(
        eq(triggersReceivedEvents.id, id),
        notInArray(triggersReceivedEvents.outcome, ['routed', 'discarded']),
      ),
    );
}

export interface UpsertTriggeredDecisionParams {
  receivedEventId: string;
  subscription: TriggerSubscription;
  run: {id: string; name: string};
}

export async function upsertTriggeredDecision(
  params: UpsertTriggeredDecisionParams,
): Promise<void> {
  await db()
    .insert(triggersDecisions)
    .values({
      receivedEventId: params.receivedEventId,
      subscriptionId: params.subscription.id,
      subscriptionName: params.subscription.name,
      workflowDefinitionId: params.subscription.workflowDefinitionId,
      projectId: params.subscription.projectId,
      decision: 'triggered',
      runId: params.run.id,
      runName: params.run.name,
      reason: null,
    })
    .onConflictDoUpdate({
      target: [triggersDecisions.receivedEventId, triggersDecisions.subscriptionId],
      set: {decision: 'triggered', runId: params.run.id, runName: params.run.name, reason: null},
    });
}

export interface UpsertErroredDecisionParams {
  receivedEventId: string;
  subscription: TriggerSubscription;
  reason: string;
}

// A created run is ground truth. A later retry failure must not erase it.
export async function upsertErroredDecision(params: UpsertErroredDecisionParams): Promise<void> {
  await db()
    .insert(triggersDecisions)
    .values({
      receivedEventId: params.receivedEventId,
      subscriptionId: params.subscription.id,
      subscriptionName: params.subscription.name,
      workflowDefinitionId: params.subscription.workflowDefinitionId,
      projectId: params.subscription.projectId,
      decision: 'errored',
      reason: params.reason,
    })
    .onConflictDoUpdate({
      target: [triggersDecisions.receivedEventId, triggersDecisions.subscriptionId],
      set: {decision: 'errored', reason: params.reason, runId: null, runName: null},
      setWhere: ne(triggersDecisions.decision, 'triggered'),
    });
}
