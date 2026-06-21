import {eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {triggersDecisions} from '#db/schema/decisions.js';
import {triggersReceivedEvents} from '#db/schema/received-events.js';
import {triggerSubscriptionFactory} from '#test/index.js';

const runWorkflow = vi.fn();

vi.mock('@shipfox/api-workflows', () => ({
  runWorkflow: (...args: unknown[]) => runWorkflow(...args),
}));

// Import after mocks so the core dispatcher sees the spy.
const {dispatchIntegrationEvent} = await import('./dispatch-integration-event.js');

interface DispatchOverrides {
  eventRef?: string;
  workspaceId?: string;
  source?: string;
  event?: string;
  deliveryId?: string;
  connectionId?: string;
  payload?: unknown;
  receivedAt?: Date;
}

function dispatch(overrides: DispatchOverrides = {}): Promise<void> {
  return dispatchIntegrationEvent({
    eventRef: overrides.eventRef ?? crypto.randomUUID(),
    source: overrides.source ?? 'github',
    event: overrides.event ?? 'push',
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    connectionId: overrides.connectionId ?? crypto.randomUUID(),
    deliveryId: overrides.deliveryId ?? crypto.randomUUID(),
    receivedAt: overrides.receivedAt ?? new Date(),
    payload: overrides.payload ?? {ref: 'main', headCommitSha: 'abc123'},
  });
}

async function receivedEvent(eventRef: string) {
  const [row] = await db()
    .select()
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.eventRef, eventRef));
  return row;
}

function decisionsForEvent(receivedEventId: string) {
  return db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId));
}

describe('dispatchIntegrationEvent', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
  });

  test('fires the workflow for each matching workspace subscription, regardless of project', async () => {
    const workspaceId = crypto.randomUUID();
    const subA = await triggerSubscriptionFactory.create({
      workspaceId,
      projectId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
      config: {},
    });
    const subB = await triggerSubscriptionFactory.create({
      workspaceId,
      projectId: crypto.randomUUID(),
      source: 'github',
      event: 'push',
      config: {},
    });

    await dispatch({workspaceId});

    expect(runWorkflow).toHaveBeenCalledTimes(2);
    const firedProjects = runWorkflow.mock.calls.map(([params]) => params.projectId);
    expect(firedProjects).toEqual(expect.arrayContaining([subA.projectId, subB.projectId]));
  });

  test('passes the source, event, deliveryId and raw payload through as the trigger payload', async () => {
    const workspaceId = crypto.randomUUID();
    const deliveryId = crypto.randomUUID();
    const payload = {ref: 'refs/heads/feature', headCommitSha: 'deadbeef'};
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });

    await dispatch({workspaceId, deliveryId, payload});

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPayload: {source: 'github', event: 'push', deliveryId, data: payload},
      }),
    );
  });

  test('dispatches an arbitrary non-github source without any source-specific handling', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'sentry',
      event: 'alert_triggered',
      config: {},
    });

    await dispatch({workspaceId, source: 'sentry', event: 'alert_triggered'});

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPayload: expect.objectContaining({source: 'sentry', event: 'alert_triggered'}),
      }),
    );
  });

  test('passes triggerIdempotencyKey = subscription.id:eventRef to runWorkflow', async () => {
    const workspaceId = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const eventRef = crypto.randomUUID();

    await dispatch({workspaceId, eventRef});

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({triggerIdempotencyKey: `${subscription.id}:${eventRef}`}),
    );
  });

  test('forwards subscription.config.with as inputs to runWorkflow', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {with: {env: 'staging'}},
    });

    await dispatch({workspaceId});

    expect(runWorkflow).toHaveBeenCalledWith(expect.objectContaining({inputs: {env: 'staging'}}));
  });

  test('does not fire when no subscription matches the workspace, source and event', async () => {
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });

    await dispatch({workspaceId, event: 'pull_request'});

    expect(runWorkflow).not.toHaveBeenCalled();
  });
});

describe('dispatchIntegrationEvent trigger history', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
  });

  test('records a discarded event when no subscription matches', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();

    await dispatch({workspaceId, event: 'pull_request', eventRef});

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.origin).toBe('integration');
    expect(event.outcome).toBe('discarded');
    expect(event.matchedCount).toBe(0);
    expect(event.processedAt).toBeInstanceOf(Date);
    expect(await decisionsForEvent(event.id)).toHaveLength(0);
  });

  test('records a routed event with a triggered decision per matched subscription', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subA = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const subB = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const runs: {id: string; name: string}[] = [];
    runWorkflow.mockImplementation(() => {
      const run = {id: crypto.randomUUID(), name: 'Build and test'};
      runs.push(run);
      return run;
    });

    await dispatch({workspaceId, eventRef});

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(2);
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.decision === 'triggered')).toBe(true);
    expect(decisions.map((d) => d.subscriptionId).sort()).toEqual([subA.id, subB.id].sort());
    expect(decisions.map((d) => d.runId).sort()).toEqual(runs.map((r) => r.id).sort());
    expect(decisions.every((d) => d.runName === 'Build and test')).toBe(true);
  });

  test('records a failed event, stops the loop at the first throw, and re-throws', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    runWorkflow.mockRejectedValue(new Error('runWorkflow boom'));

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('runWorkflow boom');

    // Every match would throw, so one call proves the loop stops at the first failure.
    expect(runWorkflow).toHaveBeenCalledTimes(1);
    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.matchedCount).toBe(2);
    expect(event.processedAt).toBeNull();
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('errored');
    expect(decisions[0]?.reason).toContain('runWorkflow boom');
  });

  test('replaying the same event does not duplicate rows and reuses the idempotency key', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Build and test'});

    await dispatch({workspaceId, eventRef});
    await dispatch({workspaceId, eventRef});

    const events = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, eventRef));
    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) throw new Error('received event not found');
    expect(await decisionsForEvent(event.id)).toHaveLength(1);
    // `runWorkflow` is mocked here; run-row dedup depends on stable keys at its boundary.
    const keys = runWorkflow.mock.calls.map(([params]) => params.triggerIdempotencyKey);
    expect(keys).toEqual([`${subscription.id}:${eventRef}`, `${subscription.id}:${eventRef}`]);
  });

  test('records a triggered and an errored decision for a mixed-outcome fan-out', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Build and test'};
    runWorkflow.mockResolvedValueOnce(run).mockRejectedValueOnce(new Error('second boom'));

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('second boom');

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('failed');
    expect(event.matchedCount).toBe(2);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(2);
    const triggered = decisions.find((d) => d.decision === 'triggered');
    const errored = decisions.find((d) => d.decision === 'errored');
    expect(triggered?.runId).toBe(run.id);
    expect(errored?.reason).toContain('second boom');
  });

  test('converges a failed event to routed when a later replay succeeds', async () => {
    const workspaceId = crypto.randomUUID();
    const eventRef = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const run = {id: crypto.randomUUID(), name: 'Build and test'};
    runWorkflow.mockRejectedValueOnce(new Error('transient boom')).mockResolvedValue(run);

    await expect(dispatch({workspaceId, eventRef})).rejects.toThrow('transient boom');
    await dispatch({workspaceId, eventRef});

    const event = await receivedEvent(eventRef);
    if (!event) throw new Error('received event not found');
    expect(event.outcome).toBe('routed');
    expect(event.matchedCount).toBe(1);
    expect(event.processedAt).toBeInstanceOf(Date);
    const decisions = await decisionsForEvent(event.id);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.subscriptionId).toBe(subscription.id);
    expect(decisions[0]?.decision).toBe('triggered');
    expect(decisions[0]?.runId).toBe(run.id);
    expect(decisions[0]?.reason).toBeNull();
  });
});
