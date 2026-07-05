import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {triggerSubscriptionFactory} from '#test/index.js';
import {TriggerSubscriptionNotCronError} from './errors.js';

const runWorkflow = vi.fn();

// Keep a real-enough permanent-error class + the classifier so the cron path's
// permanent/transient branching is exercised without loading the workflows module graph.
vi.mock('@shipfox/api-workflows', () => {
  class DefinitionNotFoundError extends Error {
    constructor(definitionId: string) {
      super(`Definition not found: ${definitionId}`);
      this.name = 'DefinitionNotFoundError';
    }
  }
  return {
    runWorkflow: (...args: unknown[]) => runWorkflow(...args),
    DefinitionNotFoundError,
    isPermanentRunWorkflowError: (error: unknown) => error instanceof DefinitionNotFoundError,
  };
});

import {DefinitionNotFoundError} from '@shipfox/api-workflows';

// Import after mocks so the function under test sees the spy.
const {fireCronSubscription} = await import('./fire-cron.js');

const SLOT = new Date('2026-07-05T02:00:00.000Z');

function eventsForWorkspace(workspaceId: string) {
  return db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.workspaceId, workspaceId));
}

function decisionsForEvent(receivedEventId: string) {
  return db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId));
}

describe('fireCronSubscription', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
  });

  test('records a routed cron event and a triggered decision on success', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'cron',
      event: 'tick',
      config: {with: {environment: 'staging'}},
    });
    const run = {id: crypto.randomUUID(), name: 'Cron run'};
    runWorkflow.mockResolvedValue(run);

    const result = await fireCronSubscription({
      subscriptionId: subscription.id,
      scheduledSlot: SLOT,
    });

    expect(result).toEqual({outcome: 'fired', run});
    const [payload] = runWorkflow.mock.calls[0] as [Record<string, unknown>];
    expect(payload.triggerPayload).toEqual({
      provider: 'cron',
      source: 'cron',
      event: 'tick',
      scheduleId: subscription.id,
    });
    expect(payload.inputs).toEqual({environment: 'staging'});
    expect(payload.triggerIdempotencyKey).toBe(`${subscription.id}:${SLOT.toISOString()}`);
    const [event] = await eventsForWorkspace(subscription.workspaceId);
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('cron');
    expect(event.source).toBe('cron');
    expect(event.provider).toBeNull();
    expect(event.outcome).toBe('routed');
    expect(event.eventRef).toBe(`${subscription.id}:${SLOT.toISOString()}`);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('triggered');
    expect(decisions[0]?.runId).toBe(run.id);
  });

  test('returns errored (terminal) and records an errored decision on a permanent failure', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'cron',
      event: 'tick',
      config: {},
    });
    runWorkflow.mockRejectedValue(new DefinitionNotFoundError('def-gone'));

    const result = await fireCronSubscription({
      subscriptionId: subscription.id,
      scheduledSlot: SLOT,
    });

    expect(result).toEqual({outcome: 'errored'});
    const [event] = await eventsForWorkspace(subscription.workspaceId);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions[0]?.decision).toBe('errored');
    expect(decisions[0]?.reason).toContain('Definition not found');
  });

  test('re-throws and leaves the event non-terminal on a transient failure', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'cron',
      event: 'tick',
      config: {},
    });
    runWorkflow.mockRejectedValue(new Error('cron boom'));

    await expect(
      fireCronSubscription({subscriptionId: subscription.id, scheduledSlot: SLOT}),
    ).rejects.toThrow('cron boom');

    const [event] = await eventsForWorkspace(subscription.workspaceId);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.processedAt).toBeNull();
    const decisions = await decisionsForEvent(event.id);
    expect(decisions[0]?.decision).toBe('errored');
  });

  test('throws and records nothing when the subscription is not a cron trigger', async () => {
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });

    await expect(
      fireCronSubscription({subscriptionId: subscription.id, scheduledSlot: SLOT}),
    ).rejects.toThrow(TriggerSubscriptionNotCronError);

    expect(await eventsForWorkspace(subscription.workspaceId)).toHaveLength(0);
    expect(runWorkflow).not.toHaveBeenCalled();
  });
});
