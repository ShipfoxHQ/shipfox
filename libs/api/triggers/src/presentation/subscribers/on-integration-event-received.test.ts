import type {IntegrationEventReceivedEvent} from '@shipfox/api-integration-core-dto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import type {DomainEvent} from '@shipfox/node-outbox';

const dispatchIntegrationEvent = vi.fn();

vi.mock('#core/dispatch-integration-event.js', () => ({
  dispatchIntegrationEvent: (...args: unknown[]) => dispatchIntegrationEvent(...args),
}));

const {createOnIntegrationEventReceived} = await import('./on-integration-event-received.js');

const workflows = {} as WorkflowsModuleClient;

describe('onIntegrationEventReceived', () => {
  beforeEach(() => {
    dispatchIntegrationEvent.mockReset();
  });

  test('passes the integration envelope to the core dispatcher', async () => {
    const receivedAt = '2026-06-21T03:20:00.000Z';
    const envelope: IntegrationEventReceivedEvent = {
      provider: 'github',
      source: 'github',
      event: 'push',
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      connectionName: 'Acme Production',
      deliveryId: crypto.randomUUID(),
      receivedAt,
      payload: {ref: 'main', headCommitSha: 'abc123'},
    };
    const event: DomainEvent<IntegrationEventReceivedEvent> = {
      id: crypto.randomUUID(),
      type: 'integrations.event.received',
      createdAt: new Date(),
      payload: envelope,
    };

    await createOnIntegrationEventReceived(workflows)(envelope, event);

    expect(dispatchIntegrationEvent).toHaveBeenCalledWith({
      workflows,
      eventRef: event.id,
      workspaceId: envelope.workspaceId,
      provider: envelope.provider,
      source: envelope.source,
      event: envelope.event,
      deliveryId: envelope.deliveryId,
      connectionId: envelope.connectionId,
      connectionName: envelope.connectionName,
      payload: envelope.payload,
      receivedAt: new Date(receivedAt),
    });
  });
});
