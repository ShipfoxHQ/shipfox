import type {
  GithubPushPayload,
  IntegrationEventReceivedEvent,
} from '@shipfox/api-integration-core-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {triggerSubscriptionFactory} from '#test/index.js';

const getProjectBySource = vi.fn();
const runWorkflow = vi.fn();

vi.mock('@shipfox/api-projects', () => ({
  getProjectBySource: (...args: unknown[]) => getProjectBySource(...args),
}));

vi.mock('@shipfox/api-workflows', () => ({
  runWorkflow: (...args: unknown[]) => runWorkflow(...args),
}));

// Import after mocks so the subscriber sees the spies.
const {onIntegrationEventReceived} = await import('./on-integration-event-received.js');

function buildPushPayload(overrides: Partial<GithubPushPayload> = {}): GithubPushPayload {
  return {
    externalRepositoryId: 'github:42',
    ref: 'main',
    headCommitSha: 'abc123',
    defaultBranch: 'main',
    isDefaultBranch: true,
    ...overrides,
  };
}

function buildEnvelope(
  overrides: Partial<IntegrationEventReceivedEvent> = {},
  pushOverrides: Partial<GithubPushPayload> = {},
): IntegrationEventReceivedEvent {
  return {
    source: 'github',
    event: 'push',
    workspaceId: overrides.workspaceId ?? crypto.randomUUID(),
    connectionId: overrides.connectionId ?? crypto.randomUUID(),
    deliveryId: overrides.deliveryId ?? crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    payload: buildPushPayload(pushOverrides),
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
    getProjectBySource.mockReset();
    runWorkflow.mockReset();
  });

  test('passes triggerIdempotencyKey = subscription.id:event.id to runWorkflow', async () => {
    const workspaceId = crypto.randomUUID();
    const connectionId = crypto.randomUUID();
    const externalRepositoryId = `github:${crypto.randomUUID()}`;
    const project = {id: crypto.randomUUID(), workspaceId};
    getProjectBySource.mockResolvedValue(project);

    const subscription = await triggerSubscriptionFactory.create({
      workspaceId,
      projectId: project.id,
      source: 'github',
      event: 'push',
      config: {},
    });

    const envelope = buildEnvelope(
      {workspaceId, connectionId},
      {externalRepositoryId, ref: 'main'},
    );
    const eventId = crypto.randomUUID();

    await onIntegrationEventReceived(buildEvent(envelope, eventId));

    expect(runWorkflow).toHaveBeenCalledTimes(1);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerIdempotencyKey: `${subscription.id}:${eventId}`,
      }),
    );
  });

  test('skips runWorkflow when the push ref does not match the subscription config', async () => {
    const workspaceId = crypto.randomUUID();
    const project = {id: crypto.randomUUID(), workspaceId};
    getProjectBySource.mockResolvedValue(project);

    await triggerSubscriptionFactory.create({
      workspaceId,
      projectId: project.id,
      source: 'github',
      event: 'push',
      config: {on: 'main'},
    });
    const envelope = buildEnvelope({workspaceId}, {ref: 'feature/x'});

    await onIntegrationEventReceived(buildEvent(envelope));

    expect(runWorkflow).not.toHaveBeenCalled();
  });
});
