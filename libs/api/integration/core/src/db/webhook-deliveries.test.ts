import {
  INTEGRATION_EVENT_RECEIVED,
  type IntegrationEventReceivedEvent,
} from '@shipfox/api-integration-core-dto';
import {and, eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {integrationsOutbox} from './schema/outbox.js';
import {integrationsWebhookDeliveries} from './schema/webhook-deliveries.js';
import {publishIntegrationEventReceived, recordDeliveryOnly} from './webhook-deliveries.js';

function buildEvent(
  overrides: Partial<IntegrationEventReceivedEvent> = {},
): IntegrationEventReceivedEvent {
  return {
    source: 'github',
    event: 'push',
    workspaceId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    deliveryId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    payload: {
      externalRepositoryId: 'github:42',
      ref: 'main',
      headCommitSha: 'abc123',
      defaultBranch: 'main',
      isDefaultBranch: true,
    },
    ...overrides,
  };
}

function deliveriesFor(provider: string, deliveryId: string) {
  return db()
    .select()
    .from(integrationsWebhookDeliveries)
    .where(
      and(
        eq(integrationsWebhookDeliveries.provider, provider),
        eq(integrationsWebhookDeliveries.deliveryId, deliveryId),
      ),
    );
}

function outboxFor(deliveryId: string) {
  return db()
    .select()
    .from(integrationsOutbox)
    .where(sql`${integrationsOutbox.payload}->>'deliveryId' = ${deliveryId}`);
}

describe('integration webhook delivery persistence', () => {
  it('writes a delivery row and an outbox event for a new delivery', async () => {
    const event = buildEvent();

    const result = await publishIntegrationEventReceived({tx: db(), event});

    expect(result.published).toBe(true);
    expect(await deliveriesFor(event.source, event.deliveryId)).toHaveLength(1);
    const outbox = await outboxFor(event.deliveryId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(INTEGRATION_EVENT_RECEIVED);
    expect(outbox[0]?.payload).toMatchObject({
      source: 'github',
      event: 'push',
      deliveryId: event.deliveryId,
      payload: {externalRepositoryId: 'github:42', isDefaultBranch: true},
    });
  });

  it('does not publish a duplicate delivery twice', async () => {
    const event = buildEvent();

    const first = await publishIntegrationEventReceived({tx: db(), event});
    const second = await publishIntegrationEventReceived({tx: db(), event});

    expect(first.published).toBe(true);
    expect(second.published).toBe(false);
    expect(await deliveriesFor(event.source, event.deliveryId)).toHaveLength(1);
    expect(await outboxFor(event.deliveryId)).toHaveLength(1);
  });

  it('records a delivery without writing an outbox event', async () => {
    const deliveryId = crypto.randomUUID();

    await recordDeliveryOnly({tx: db(), provider: 'github', deliveryId});

    expect(await deliveriesFor('github', deliveryId)).toHaveLength(1);
    expect(await outboxFor(deliveryId)).toHaveLength(0);
  });

  it('ignores a duplicate delivery record', async () => {
    const deliveryId = crypto.randomUUID();

    await recordDeliveryOnly({tx: db(), provider: 'github', deliveryId});
    await recordDeliveryOnly({tx: db(), provider: 'github', deliveryId});

    expect(await deliveriesFor('github', deliveryId)).toHaveLength(1);
  });
});
