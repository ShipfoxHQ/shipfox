import {eq} from 'drizzle-orm';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {db} from './db.js';
import {
  type InsertReceivedEventParams,
  insertReceivedEvent,
  markReceivedEventDiscarded,
  markReceivedEventFailed,
  markReceivedEventRouted,
  upsertErroredDecision,
  upsertTriggeredDecision,
} from './event-history.js';
import {triggersDecisions} from './schema/decisions.js';
import {triggersReceivedEvents} from './schema/received-events.js';

function buildEventParams(
  overrides: Partial<InsertReceivedEventParams> = {},
): InsertReceivedEventParams {
  return {
    eventRef: crypto.randomUUID(),
    origin: 'integration',
    workspaceId: crypto.randomUUID(),
    source: 'github',
    event: 'push',
    deliveryId: null,
    connectionId: null,
    payload: null,
    receivedAt: new Date(),
    ...overrides,
  };
}

function buildSubscription(overrides: Partial<TriggerSubscription> = {}): TriggerSubscription {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowDefinitionId: crypto.randomUUID(),
    name: 'trigger',
    source: 'github',
    event: 'push',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function decisionsFor(receivedEventId: string) {
  return db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId));
}

describe('insertReceivedEvent', () => {
  it('inserts a received event and returns its id', async () => {
    const params = buildEventParams();

    const id = await insertReceivedEvent(params);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.eventRef).toBe(params.eventRef);
    expect(row?.outcome).toBe('received');
    expect(row?.matchedCount).toBe(0);
  });

  it('returns the existing id on event_ref conflict (replay)', async () => {
    const params = buildEventParams();

    const first = await insertReceivedEvent(params);
    const second = await insertReceivedEvent(params);

    expect(second).toBe(first);
    const rows = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, params.eventRef));
    expect(rows).toHaveLength(1);
  });
});

describe('received-event outcome transitions', () => {
  it('marks an event routed with matched_count and processed_at', async () => {
    const id = await insertReceivedEvent(buildEventParams());

    await markReceivedEventRouted(id, 3);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('routed');
    expect(row?.matchedCount).toBe(3);
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  it('marks an event discarded with matched_count 0', async () => {
    const id = await insertReceivedEvent(buildEventParams());

    await markReceivedEventDiscarded(id);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('discarded');
    expect(row?.matchedCount).toBe(0);
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  it('does not downgrade a routed event to discarded', async () => {
    const id = await insertReceivedEvent(buildEventParams());
    await markReceivedEventRouted(id, 1);

    await markReceivedEventDiscarded(id);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('routed');
    expect(row?.matchedCount).toBe(1);
  });

  it('marks an event failed without setting processed_at (transient, retried)', async () => {
    const id = await insertReceivedEvent(buildEventParams());

    await markReceivedEventFailed(id, 2);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('failed');
    expect(row?.matchedCount).toBe(2);
    expect(row?.processedAt).toBeNull();
  });

  it('does not downgrade a routed event to failed (terminal success wins under a stale failed write)', async () => {
    const id = await insertReceivedEvent(buildEventParams());
    await markReceivedEventRouted(id, 2);

    await markReceivedEventFailed(id, 2);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('routed');
    expect(row?.processedAt).toBeInstanceOf(Date);
  });
});

describe('decision upserts', () => {
  it('is idempotent on (received_event_id, subscription_id)', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildSubscription();
    const run = {id: crypto.randomUUID(), name: 'Build and test'};

    await upsertTriggeredDecision({receivedEventId, subscription, run});
    await upsertTriggeredDecision({receivedEventId, subscription, run});

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('triggered');
    expect(rows[0]?.runId).toBe(run.id);
    expect(rows[0]?.runName).toBe(run.name);
  });

  it('flips an errored decision to triggered on a successful retry', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildSubscription();
    const run = {id: crypto.randomUUID(), name: 'Build and test'};

    await upsertErroredDecision({receivedEventId, subscription, reason: 'boom'});
    await upsertTriggeredDecision({receivedEventId, subscription, run});

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('triggered');
    expect(rows[0]?.runId).toBe(run.id);
    expect(rows[0]?.reason).toBeNull();
  });

  it('never downgrades an existing triggered decision to errored', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildSubscription();
    const run = {id: crypto.randomUUID(), name: 'Build and test'};

    await upsertTriggeredDecision({receivedEventId, subscription, run});
    await upsertErroredDecision({receivedEventId, subscription, reason: 'definition deleted'});

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('triggered');
    expect(rows[0]?.runId).toBe(run.id);
    expect(rows[0]?.reason).toBeNull();
  });
});
