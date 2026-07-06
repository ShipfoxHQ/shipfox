import {eq} from 'drizzle-orm';
import {db} from '../db.js';
import {
  type TriggerDecisionDb,
  type TriggerDecisionInsertDb,
  toTriggerDecision,
  triggersDecisions,
} from './decisions.js';
import {triggersReceivedEvents} from './received-events.js';

describe('toTriggerDecision', () => {
  test('maps a fully populated row to the domain entity', () => {
    const row: TriggerDecisionDb = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      receivedEventId: '019e98ab-b90f-7265-b13c-8b441c991381',
      subscriptionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      subscriptionName: 'Deploy production',
      workflowDefinitionId: '019e98ab-b90f-7265-b13c-8b441c991383',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991384',
      decision: 'triggered',
      runId: '019e98ab-b90f-7265-b13c-8b441c991385',
      runName: 'Build and test',
      reason: null,
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    };

    const result = toTriggerDecision(row);

    expect(result).toEqual({
      id: row.id,
      receivedEventId: row.receivedEventId,
      subscriptionId: row.subscriptionId,
      subscriptionName: 'Deploy production',
      workflowDefinitionId: row.workflowDefinitionId,
      projectId: row.projectId,
      decision: 'triggered',
      runId: row.runId,
      runName: 'Build and test',
      reason: null,
      createdAt: row.createdAt,
    });
  });

  test('passes through null run_id, run_name, and a populated reason', () => {
    const row: TriggerDecisionDb = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      receivedEventId: '019e98ab-b90f-7265-b13c-8b441c991381',
      subscriptionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      subscriptionName: 'Deploy production',
      workflowDefinitionId: '019e98ab-b90f-7265-b13c-8b441c991383',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991384',
      decision: 'dispatch-error',
      runId: null,
      runName: null,
      reason: 'runWorkflow threw',
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    };

    const result = toTriggerDecision(row);

    expect(result.decision).toBe('dispatch-error');
    expect(result.runId).toBeNull();
    expect(result.runName).toBeNull();
    expect(result.reason).toBe('runWorkflow threw');
  });

  test('maps legacy errored rows to dispatch-error', () => {
    const row = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      receivedEventId: '019e98ab-b90f-7265-b13c-8b441c991381',
      subscriptionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      subscriptionName: 'Deploy production',
      workflowDefinitionId: '019e98ab-b90f-7265-b13c-8b441c991383',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991384',
      decision: 'errored',
      runId: null,
      runName: null,
      reason: 'runWorkflow threw',
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    } as unknown as TriggerDecisionDb;

    const result = toTriggerDecision(row);

    expect(result.decision).toBe('dispatch-error');
  });
});

describe('triggers_decisions schema', () => {
  async function insertEvent(): Promise<string> {
    const [event] = await db()
      .insert(triggersReceivedEvents)
      .values({
        eventRef: crypto.randomUUID(),
        origin: 'integration',
        workspaceId: crypto.randomUUID(),
        source: 'github',
        event: 'push',
        receivedAt: new Date(),
      })
      .returning();
    if (!event) throw new Error('insert returned no rows');
    return event.id;
  }

  test('applies defaults and maps an inserted row', async () => {
    const receivedEventId = await insertEvent();
    const values: TriggerDecisionInsertDb = {
      receivedEventId,
      subscriptionId: crypto.randomUUID(),
      subscriptionName: 'Deploy production',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      decision: 'triggered',
    };

    const [inserted] = await db()
      .insert(triggersDecisions)
      .values(values)
      .returning({id: triggersDecisions.id});
    if (!inserted) throw new Error('insert returned no rows');
    const [row] = await db()
      .select()
      .from(triggersDecisions)
      .where(eq(triggersDecisions.id, inserted.id));
    if (!row) throw new Error('select returned no rows');
    const result = toTriggerDecision(row);

    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.runId).toBeNull();
    expect(row.runName).toBeNull();
    expect(row.reason).toBeNull();
    expect(result).toMatchObject({
      receivedEventId,
      subscriptionId: values.subscriptionId,
      subscriptionName: 'Deploy production',
      workflowDefinitionId: values.workflowDefinitionId,
      projectId: values.projectId,
      decision: 'triggered',
    });
  });

  test('cascades decision deletes when the parent event is removed', async () => {
    const receivedEventId = await insertEvent();
    await db().insert(triggersDecisions).values({
      receivedEventId,
      subscriptionId: crypto.randomUUID(),
      subscriptionName: 'Deploy production',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      decision: 'triggered',
    });

    await db().delete(triggersReceivedEvents).where(eq(triggersReceivedEvents.id, receivedEventId));

    const rows = await db()
      .select()
      .from(triggersDecisions)
      .where(eq(triggersDecisions.receivedEventId, receivedEventId));
    expect(rows).toHaveLength(0);
  });

  test('rejects a duplicate (received_event_id, subscription_id)', async () => {
    const receivedEventId = await insertEvent();
    const values: TriggerDecisionInsertDb = {
      receivedEventId,
      subscriptionId: crypto.randomUUID(),
      subscriptionName: 'Deploy production',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      decision: 'triggered',
    };
    await db().insert(triggersDecisions).values(values);

    const duplicate = db().insert(triggersDecisions).values(values);

    await expect(duplicate).rejects.toThrow();
  });
});
