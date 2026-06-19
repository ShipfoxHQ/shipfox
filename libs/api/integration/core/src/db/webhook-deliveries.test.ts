import {
  INTEGRATION_EVENT_RECEIVED,
  INTEGRATION_SOURCE_COMMIT_PUSHED,
  type IntegrationEventReceivedEvent,
  type SourcePushPayload,
} from '@shipfox/api-integration-core-dto';
import {and, eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {integrationsOutbox} from './schema/outbox.js';
import {integrationsWebhookDeliveries} from './schema/webhook-deliveries.js';
import {
  publishIntegrationEventReceived,
  publishSourceCommitPushed,
  publishSourcePush,
  recordDeliveryOnly,
} from './webhook-deliveries.js';

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

function buildPush(overrides: Partial<SourcePushPayload> = {}): SourcePushPayload {
  return {
    externalRepositoryId: 'github:42',
    ref: 'main',
    headCommitSha: 'abc123',
    defaultBranch: 'main',
    isDefaultBranch: true,
    ...overrides,
  };
}

function buildSourcePushParams() {
  return {
    provider: 'github',
    workspaceId: crypto.randomUUID(),
    connectionId: crypto.randomUUID(),
    deliveryId: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    push: buildPush(),
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

describe('publishSourcePush', () => {
  it('writes the delivery row plus both outbox events for a new delivery', async () => {
    const params = buildSourcePushParams();

    const result = await db().transaction((tx) => publishSourcePush({tx, ...params}));

    expect(result.published).toBe(true);
    expect(await deliveriesFor(params.provider, params.deliveryId)).toHaveLength(1);
    const types = (await outboxFor(params.deliveryId)).map((row) => row.eventType).sort();
    expect(types).toEqual([INTEGRATION_EVENT_RECEIVED, INTEGRATION_SOURCE_COMMIT_PUSHED].sort());
  });

  it('emits the generic envelope (for triggers) and the typed event (for projects)', async () => {
    const params = buildSourcePushParams();

    await db().transaction((tx) => publishSourcePush({tx, ...params}));

    const outbox = await outboxFor(params.deliveryId);
    const envelope = outbox.find((row) => row.eventType === INTEGRATION_EVENT_RECEIVED);
    const typed = outbox.find((row) => row.eventType === INTEGRATION_SOURCE_COMMIT_PUSHED);
    expect(envelope?.payload).toMatchObject({
      source: 'github',
      event: 'push',
      deliveryId: params.deliveryId,
      payload: {externalRepositoryId: 'github:42', isDefaultBranch: true},
    });
    expect(typed?.payload).toMatchObject({
      provider: 'github',
      deliveryId: params.deliveryId,
      push: {externalRepositoryId: 'github:42', ref: 'main', headCommitSha: 'abc123'},
    });
  });

  it('writes nothing for a duplicate delivery', async () => {
    const params = buildSourcePushParams();

    const first = await db().transaction((tx) => publishSourcePush({tx, ...params}));
    const second = await db().transaction((tx) => publishSourcePush({tx, ...params}));

    expect(first.published).toBe(true);
    expect(second.published).toBe(false);
    expect(await deliveriesFor(params.provider, params.deliveryId)).toHaveLength(1);
    expect(await outboxFor(params.deliveryId)).toHaveLength(2);
  });
});

describe('publishSourceCommitPushed', () => {
  function buildParams() {
    return {
      provider: 'debug',
      workspaceId: crypto.randomUUID(),
      connectionId: crypto.randomUUID(),
      deliveryId: crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      push: buildPush({externalRepositoryId: 'debug:platform'}),
    };
  }

  it('writes only the typed event, never the generic envelope', async () => {
    const params = buildParams();

    await publishSourceCommitPushed(params);

    const outbox = await outboxFor(params.deliveryId);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.eventType).toBe(INTEGRATION_SOURCE_COMMIT_PUSHED);
    expect(outbox.some((row) => row.eventType === INTEGRATION_EVENT_RECEIVED)).toBe(false);
    expect(outbox[0]?.payload).toMatchObject({
      provider: 'debug',
      deliveryId: params.deliveryId,
      push: {externalRepositoryId: 'debug:platform', isDefaultBranch: true},
    });
  });

  it('does not write a webhook-delivery dedup row', async () => {
    const params = buildParams();

    await publishSourceCommitPushed(params);

    expect(await deliveriesFor(params.provider, params.deliveryId)).toHaveLength(0);
  });
});
