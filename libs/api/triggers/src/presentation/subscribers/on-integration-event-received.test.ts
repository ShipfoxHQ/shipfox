import type {IntegrationEventReceivedEvent} from '@shipfox/api-integration-core-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {triggerSubscriptionFactory} from '#test/index.js';

const runWorkflow = vi.fn();

vi.mock('@shipfox/api-workflows', () => ({
  runWorkflow: (...args: unknown[]) => runWorkflow(...args),
}));

// Import after mocks so the subscriber sees the spies.
const {onIntegrationEventReceived} = await import('./on-integration-event-received.js');

function buildEnvelope(
  overrides: Partial<IntegrationEventReceivedEvent> = {},
): IntegrationEventReceivedEvent {
  return {
    source: 'github',
    event: 'push',
    workspaceId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    deliveryId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    payload: {ref: 'main', headCommitSha: 'abc123'},
    ...overrides,
  };
}

function buildEvent(payload: IntegrationEventReceivedEvent, id = crypto.randomUUID()): DomainEvent {
  return {
    id,
    type: 'integrations.event.received',
    createdAt: new Date(),
    payload,
  };
}

describe('onIntegrationEventReceived (triggers)', () => {
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

    await onIntegrationEventReceived(buildEvent(buildEnvelope({workspaceId})));

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

    await onIntegrationEventReceived(buildEvent(buildEnvelope({workspaceId, deliveryId, payload})));

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

    await onIntegrationEventReceived(
      buildEvent(buildEnvelope({workspaceId, source: 'sentry', event: 'alert_triggered'})),
    );

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerPayload: expect.objectContaining({source: 'sentry', event: 'alert_triggered'}),
      }),
    );
  });

  test('passes triggerIdempotencyKey = subscription.id:event.id to runWorkflow', async () => {
    const workspaceId = crypto.randomUUID();
    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const eventId = crypto.randomUUID();

    await onIntegrationEventReceived(buildEvent(buildEnvelope({workspaceId}), eventId));

    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({triggerIdempotencyKey: `${subscription.id}:${eventId}`}),
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

    await onIntegrationEventReceived(buildEvent(buildEnvelope({workspaceId})));

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

    await onIntegrationEventReceived(
      buildEvent(buildEnvelope({workspaceId, event: 'pull_request'})),
    );

    expect(runWorkflow).not.toHaveBeenCalled();
  });
});
