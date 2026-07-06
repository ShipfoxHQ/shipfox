import {triggerSubscriptionFactory} from '#test/index.js';

const runWorkflow = vi.fn();
const insertReceivedEvent = vi.fn();
const markReceivedEventRouted = vi.fn();
const upsertTriggeredDecision = vi.fn();

vi.mock('@shipfox/api-workflows', () => ({
  runWorkflow: (...args: unknown[]) => runWorkflow(...args),
  isPermanentRunWorkflowError: () => false,
}));

vi.mock('#db/event-history.js', () => ({
  insertReceivedEvent: (...args: unknown[]) => insertReceivedEvent(...args),
  markReceivedEventDiscarded: vi.fn(),
  markReceivedEventRouted: (...args: unknown[]) => markReceivedEventRouted(...args),
  markReceivedEventFailed: vi.fn(),
  markReceivedEventErrored: vi.fn(),
  upsertTriggeredDecision: (...args: unknown[]) => upsertTriggeredDecision(...args),
  upsertDispatchErrorDecision: vi.fn(),
  upsertFilterErrorDecision: vi.fn(),
}));

// Import after mocks so the code under test sees the spies.
const {beginTriggerHistory, toReason} = await import('./record-trigger-history.js');
const {fireManualSubscription} = await import('./fire-manual.js');

describe('trigger history is best-effort and never blocks triggering', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
    insertReceivedEvent.mockReset();
    insertReceivedEvent.mockRejectedValue(new Error('history db down'));
  });

  test('beginTriggerHistory resolves and its methods never throw when the insert fails', async () => {
    const recorder = await beginTriggerHistory({
      eventRef: crypto.randomUUID(),
      origin: 'integration',
      workspaceId: crypto.randomUUID(),
      provider: 'github',
      source: 'github',
      event: 'push',
      deliveryId: null,
      connectionId: null,
      connectionName: null,
      payload: null,
      receivedAt: new Date(),
    });
    const subscription = triggerSubscriptionFactory.build();

    await expect(
      recorder.triggered(subscription, {id: crypto.randomUUID(), name: 'r'}),
    ).resolves.toBeUndefined();
    await expect(recorder.dispatchErrored(subscription, 'boom')).resolves.toBeUndefined();
    await expect(recorder.filterErrored(subscription, 'bad filter')).resolves.toBeUndefined();
    await expect(recorder.discarded()).resolves.toBeUndefined();
    await expect(recorder.routed(1)).resolves.toBeUndefined();
    await expect(recorder.failed(1)).resolves.toBeUndefined();
    await expect(recorder.allErrored(1)).resolves.toBeUndefined();
  });

  test('fireManualSubscription still returns the run when history recording fails', async () => {
    const run = {id: crypto.randomUUID(), name: 'Manual run'};
    runWorkflow.mockResolvedValue(run);
    const subscription = await triggerSubscriptionFactory.create({
      source: 'manual',
      event: 'fire',
      config: {},
    });

    const result = await fireManualSubscription({
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: crypto.randomUUID(),
    });

    expect(result).toEqual(run);
    expect(runWorkflow).toHaveBeenCalledTimes(1);
  });
});

describe('a per-write failure after a successful insert is swallowed', () => {
  beforeEach(() => {
    insertReceivedEvent.mockReset();
    markReceivedEventRouted.mockReset();
    upsertTriggeredDecision.mockReset();
    insertReceivedEvent.mockResolvedValue(crypto.randomUUID());
    markReceivedEventRouted.mockRejectedValue(new Error('route write failed'));
    upsertTriggeredDecision.mockRejectedValue(new Error('decision write failed'));
  });

  test('recorder methods resolve when the insert succeeds but a later write throws', async () => {
    const recorder = await beginTriggerHistory({
      eventRef: crypto.randomUUID(),
      origin: 'integration',
      workspaceId: crypto.randomUUID(),
      provider: 'github',
      source: 'github',
      event: 'push',
      deliveryId: null,
      connectionId: null,
      connectionName: null,
      payload: null,
      receivedAt: new Date(),
    });
    const subscription = triggerSubscriptionFactory.build();

    await expect(
      recorder.triggered(subscription, {id: crypto.randomUUID(), name: 'r'}),
    ).resolves.toBeUndefined();
    await expect(recorder.routed(1)).resolves.toBeUndefined();

    // Prove the post-insert writes were actually attempted (not skipped by the
    // missing-id no-op), so the assertions exercise the swallow path they claim to.
    expect(upsertTriggeredDecision).toHaveBeenCalledTimes(1);
    expect(markReceivedEventRouted).toHaveBeenCalledTimes(1);
  });
});

describe('toReason', () => {
  test('caps an over-long message at the maximum reason length', () => {
    const reason = toReason(new Error('x'.repeat(5000)));

    expect(reason).toHaveLength(2000);
  });

  test('stringifies a non-Error throwable', () => {
    const reason = toReason('plain string failure');

    expect(reason).toBe('plain string failure');
  });

  test('falls back when a non-Error throwable cannot be stringified', () => {
    const reason = toReason({
      toString() {
        throw new Error('string conversion failed');
      },
    });

    expect(reason).toBe('[unprintable thrown value]');
  });

  test('passes a short Error message through verbatim', () => {
    const reason = toReason(new Error('definition deleted'));

    expect(reason).toBe('definition deleted');
  });
});
