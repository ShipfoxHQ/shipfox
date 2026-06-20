import type {IntegrationEventReceivedEvent} from '@shipfox/api-integration-core-dto';
import type {DomainEvent} from '@shipfox/node-outbox';
import {triggerSubscriptionFactory} from '#test/index.js';

const runWorkflow = vi.fn();
const insertReceivedEvent = vi.fn();

vi.mock('@shipfox/api-workflows', () => ({
  runWorkflow: (...args: unknown[]) => runWorkflow(...args),
}));

vi.mock('#db/event-history.js', () => ({
  insertReceivedEvent: (...args: unknown[]) => insertReceivedEvent(...args),
  markReceivedEventDiscarded: vi.fn(),
  markReceivedEventRouted: vi.fn(),
  markReceivedEventFailed: vi.fn(),
  upsertTriggeredDecision: vi.fn(),
  upsertErroredDecision: vi.fn(),
}));

// Import after mocks so the subscriber sees the spies.
const {onIntegrationEventReceived} = await import('./on-integration-event-received.js');

describe('onIntegrationEventReceived resilience to history-write failure', () => {
  beforeEach(() => {
    runWorkflow.mockReset();
    insertReceivedEvent.mockReset();
    insertReceivedEvent.mockRejectedValue(new Error('history db down'));
  });

  test('still fires runWorkflow and does not throw when history recording fails', async () => {
    runWorkflow.mockResolvedValue({id: crypto.randomUUID(), name: 'Build'});
    const workspaceId = crypto.randomUUID();
    await triggerSubscriptionFactory.create({
      workspaceId,
      source: 'github',
      event: 'push',
      config: {},
    });
    const envelope: IntegrationEventReceivedEvent = {
      source: 'github',
      event: 'push',
      workspaceId,
      connectionId: crypto.randomUUID(),
      deliveryId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      payload: {ref: 'main'},
    };
    const event: DomainEvent<IntegrationEventReceivedEvent> = {
      id: crypto.randomUUID(),
      type: 'integrations.event.received',
      createdAt: new Date(),
      payload: envelope,
    };

    await expect(onIntegrationEventReceived(envelope, event)).resolves.toBeUndefined();

    expect(runWorkflow).toHaveBeenCalledTimes(1);
  });
});
