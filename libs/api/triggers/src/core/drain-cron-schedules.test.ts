import {eq} from 'drizzle-orm';
import type {CronSchedule} from '#core/entities/cron-schedule.js';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {countDueCronSchedules} from '#db/cron-schedules.js';
import {db} from '#db/db.js';
import {triggersCronSchedules} from '#db/schema/cron-schedules.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {cronScheduleFactory, triggerSubscriptionFactory} from '#test/index.js';

const runWorkflow = vi.fn();

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
const {drainDueCronSchedules} = await import('./drain-cron-schedules.js');

const MINUTE_MS = 60 * 1000;

// The drain claim is global over a shared test DB, so assertions target the specific
// subscriptions each test creates (via the deterministic idempotency key) and use
// lower bounds for any global count, mirroring the prune activity test.
interface DueCron {
  subscription: TriggerSubscription;
  schedule: CronSchedule;
  key: string;
}

async function createCronSchedule(params: {
  nextFireAt: Date;
  cronExpression?: string;
  config?: Record<string, unknown>;
}): Promise<DueCron> {
  const subscription = await triggerSubscriptionFactory.create({
    source: 'cron',
    event: 'tick',
    config: params.config ?? {},
  });
  const schedule = await cronScheduleFactory.create({
    subscriptionId: subscription.id,
    workspaceId: subscription.workspaceId,
    cronExpression: params.cronExpression ?? '*/5 * * * *',
    timezone: 'UTC',
    nextFireAt: params.nextFireAt,
  });
  return {subscription, schedule, key: `${subscription.id}:${schedule.nextFireAt.toISOString()}`};
}

function callsWithKey(key: string) {
  return runWorkflow.mock.calls.filter(
    ([params]) => (params as {triggerIdempotencyKey?: string}).triggerIdempotencyKey === key,
  );
}

async function reload(subscriptionId: string) {
  const [row] = await db()
    .select()
    .from(triggersCronSchedules)
    .where(eq(triggersCronSchedules.subscriptionId, subscriptionId));
  if (!row) throw new Error('cron schedule row not found');
  return row;
}

describe('drainDueCronSchedules', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
  });

  test('fires a due schedule exactly once, records cron history, and advances next_fire_at', async () => {
    const {subscription, schedule, key} = await createCronSchedule({
      nextFireAt: new Date(Date.now() - MINUTE_MS),
    });
    const run = {id: crypto.randomUUID(), name: 'Cron run'};
    runWorkflow.mockResolvedValue(run);

    const summary = await drainDueCronSchedules({batchSize: 1000, jitterWindowSeconds: 0});

    expect(callsWithKey(key)).toHaveLength(1);
    expect(summary.fired).toBeGreaterThanOrEqual(1);
    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, key));
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('cron');
    expect(event.outcome).toBe('routed');
    const decisions = await db()
      .select()
      .from(triggersDecisions)
      .where(eq(triggersDecisions.receivedEventId, event.id));
    expect(decisions[0]?.decision).toBe('triggered');
    expect(decisions[0]?.runId).toBe(run.id);
    const row = await reload(subscription.id);
    expect(row.nextFireAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.lastFiredAt?.getTime()).toBe(schedule.nextFireAt.getTime());
  });

  test('does not claim a schedule whose next fire time is still in the future', async () => {
    const future = new Date(Date.now() + 60 * MINUTE_MS);
    const {subscription, key} = await createCronSchedule({nextFireAt: future});
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'r'});

    await drainDueCronSchedules({batchSize: 1000, jitterWindowSeconds: 0});

    expect(callsWithKey(key)).toHaveLength(0);
    const row = await reload(subscription.id);
    expect(row.nextFireAt.getTime()).toBe(future.getTime());
    expect(row.lastFiredAt).toBeNull();
  });

  test('overdue schedule fires once and skips the intermediate windows', async () => {
    const {subscription, key} = await createCronSchedule({
      nextFireAt: new Date(Date.now() - 60 * MINUTE_MS),
      cronExpression: '*/5 * * * *',
    });
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'r'});

    await drainDueCronSchedules({batchSize: 1000, jitterWindowSeconds: 0});

    expect(callsWithKey(key)).toHaveLength(1);
    const row = await reload(subscription.id);
    const now = Date.now();
    expect(row.nextFireAt.getTime()).toBeGreaterThan(now);
    expect(row.nextFireAt.getTime()).toBeLessThan(now + 6 * MINUTE_MS);
  });

  test('passes the deterministic idempotency key and the subscription inputs to runWorkflow', async () => {
    const {subscription, key} = await createCronSchedule({
      nextFireAt: new Date(Date.now() - MINUTE_MS),
      config: {with: {environment: 'staging'}},
    });
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'r'});

    await drainDueCronSchedules({batchSize: 1000, jitterWindowSeconds: 0});

    const [params] = callsWithKey(key)[0] as [Record<string, unknown>];
    expect(params.triggerIdempotencyKey).toBe(key);
    expect(params.inputs).toEqual({environment: 'staging'});
    expect(params.triggerPayload).toEqual({
      provider: 'cron',
      source: 'cron',
      event: 'tick',
      scheduleId: subscription.id,
    });
  });

  test('records an errored decision and still advances on a permanent runWorkflow failure', async () => {
    const {subscription, key} = await createCronSchedule({
      nextFireAt: new Date(Date.now() - MINUTE_MS),
    });
    runWorkflow.mockRejectedValue(new DefinitionNotFoundError('def-gone'));

    await drainDueCronSchedules({batchSize: 1000, jitterWindowSeconds: 0});

    const [event] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, key));
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('errored');
    const decisions = await db()
      .select()
      .from(triggersDecisions)
      .where(eq(triggersDecisions.receivedEventId, event.id));
    expect(decisions[0]?.decision).toBe('errored');
    const row = await reload(subscription.id);
    expect(row.nextFireAt.getTime()).toBeGreaterThan(Date.now());
  });

  test('leaves the schedule due and unfired on a transient runWorkflow failure', async () => {
    const {subscription, schedule} = await createCronSchedule({
      nextFireAt: new Date(Date.now() - MINUTE_MS),
    });
    runWorkflow.mockRejectedValue(new Error('database unavailable'));

    await drainDueCronSchedules({batchSize: 1000, jitterWindowSeconds: 0});

    const row = await reload(subscription.id);
    expect(row.nextFireAt.getTime()).toBe(schedule.nextFireAt.getTime());
    expect(row.lastFiredAt).toBeNull();
  });

  test('invokes the liveness callback once per claimed schedule', async () => {
    await createCronSchedule({nextFireAt: new Date(Date.now() - MINUTE_MS)});
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'r'});
    const onScheduleProcessed = vi.fn();

    const summary = await drainDueCronSchedules({
      batchSize: 1000,
      jitterWindowSeconds: 0,
      onScheduleProcessed,
    });

    expect(summary.claimed).toBeGreaterThanOrEqual(1);
    expect(onScheduleProcessed).toHaveBeenCalledTimes(summary.claimed);
  });

  test('claims at most batchSize schedules per drain and leaves the rest due', async () => {
    const mine: DueCron[] = [];
    for (let index = 0; index < 5; index += 1) {
      mine.push(await createCronSchedule({nextFireAt: new Date(Date.now() - MINUTE_MS)}));
    }
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'r'});

    const summary = await drainDueCronSchedules({batchSize: 3, jitterWindowSeconds: 0});

    expect(summary.claimed).toBe(3);
    expect(runWorkflow).toHaveBeenCalledTimes(3);
    // The capped drain advanced at most 3 rows total, so at least 2 of my 5 stay due.
    let stillDue = 0;
    for (const {subscription} of mine) {
      const row = await reload(subscription.id);
      if (row.nextFireAt.getTime() <= Date.now()) stillDue += 1;
    }
    expect(stillDue).toBeGreaterThanOrEqual(2);
  });

  test('two concurrent drains fire each due schedule exactly once (SKIP LOCKED)', async () => {
    const mine: DueCron[] = [];
    for (let index = 0; index < 4; index += 1) {
      mine.push(await createCronSchedule({nextFireAt: new Date(Date.now() - MINUTE_MS)}));
    }
    // Hold the batch locks briefly so both drains are in flight while claiming.
    runWorkflow.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {id: crypto.randomUUID(), name: 'r'};
    });

    await Promise.all([
      drainDueCronSchedules({batchSize: 1000, jitterWindowSeconds: 0}),
      drainDueCronSchedules({batchSize: 1000, jitterWindowSeconds: 0}),
    ]);

    for (const {subscription, schedule, key} of mine) {
      expect(callsWithKey(key)).toHaveLength(1);
      const row = await reload(subscription.id);
      expect(row.lastFiredAt?.getTime()).toBe(schedule.nextFireAt.getTime());
      expect(row.nextFireAt.getTime()).toBeGreaterThan(Date.now());
    }
  });
});

describe('countDueCronSchedules (backlog gauge source)', () => {
  test('counts a schedule whose next fire time is due', async () => {
    await createCronSchedule({nextFireAt: new Date(Date.now() - MINUTE_MS)});

    const due = await countDueCronSchedules();

    expect(due).toBeGreaterThanOrEqual(1);
  });
});
