import {
  INTEGRATION_EVENT_RECEIVED,
  INTEGRATION_SOURCE_COMMIT_PUSHED,
  type IntegrationEventReceivedEvent,
  type IntegrationsEventMap,
  type SourcePushPayload,
} from '@shipfox/api-integration-core-dto';
import {writeOutboxEvent, writeOutboxEvents} from '@shipfox/node-outbox';
import {lt} from 'drizzle-orm';
import {db} from './db.js';
import {integrationsOutbox} from './schema/outbox.js';
import {integrationsWebhookDeliveries} from './schema/webhook-deliveries.js';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];
type Executor = IntegrationDb | IntegrationTx;

export interface PublishIntegrationEventReceivedParams {
  tx: Executor;
  event: IntegrationEventReceivedEvent;
}

export interface PublishIntegrationEventReceivedResult {
  published: boolean;
}

export async function publishIntegrationEventReceived(
  params: PublishIntegrationEventReceivedParams,
): Promise<PublishIntegrationEventReceivedResult> {
  const inserted = await params.tx
    .insert(integrationsWebhookDeliveries)
    .values({
      provider: params.event.source,
      deliveryId: params.event.deliveryId,
    })
    .onConflictDoNothing({
      target: [integrationsWebhookDeliveries.provider, integrationsWebhookDeliveries.deliveryId],
    })
    .returning({deliveryId: integrationsWebhookDeliveries.deliveryId});

  if (inserted.length === 0) return {published: false};

  await writeOutboxEvent(params.tx, integrationsOutbox, {
    type: INTEGRATION_EVENT_RECEIVED,
    payload: params.event,
  });

  return {published: true};
}

export interface PublishSourcePushParams {
  tx: IntegrationTx;
  provider: string;
  workspaceId: string;
  connectionId: string;
  connectionName: string;
  deliveryId: string;
  receivedAt: string;
  rawPayload: unknown;
  push: SourcePushPayload;
}

// Emits a single source-control push as two outbox rows: the generic
// `INTEGRATION_EVENT_RECEIVED` envelope with the raw provider payload for triggers, and the
// typed `INTEGRATION_SOURCE_COMMIT_PUSHED` event for domain modules. One delivery-dedup gates
// both, so a redelivered webhook writes nothing. Requires a transaction: the dedup insert and
// both outbox rows must commit or roll back together.
export async function publishSourcePush(
  params: PublishSourcePushParams,
): Promise<{published: boolean}> {
  const inserted = await params.tx
    .insert(integrationsWebhookDeliveries)
    .values({
      provider: params.provider,
      deliveryId: params.deliveryId,
    })
    .onConflictDoNothing({
      target: [integrationsWebhookDeliveries.provider, integrationsWebhookDeliveries.deliveryId],
    })
    .returning({deliveryId: integrationsWebhookDeliveries.deliveryId});

  if (inserted.length === 0) return {published: false};

  await writeOutboxEvents<IntegrationsEventMap>(params.tx, integrationsOutbox, [
    {
      type: INTEGRATION_EVENT_RECEIVED,
      payload: {
        source: params.provider,
        event: 'push',
        workspaceId: params.workspaceId,
        connectionId: params.connectionId,
        connectionName: params.connectionName,
        deliveryId: params.deliveryId,
        receivedAt: params.receivedAt,
        payload: params.rawPayload,
      },
    },
    {
      type: INTEGRATION_SOURCE_COMMIT_PUSHED,
      payload: {
        provider: params.provider,
        workspaceId: params.workspaceId,
        connectionId: params.connectionId,
        deliveryId: params.deliveryId,
        receivedAt: params.receivedAt,
        push: params.push,
      },
    },
  ]);

  return {published: true};
}

export interface PublishSourceCommitPushedParams {
  provider: string;
  workspaceId: string;
  connectionId: string;
  deliveryId: string;
  receivedAt: string;
  push: SourcePushPayload;
}

// Emits ONLY the typed `INTEGRATION_SOURCE_COMMIT_PUSHED` event, intentionally skipping the
// `INTEGRATION_EVENT_RECEIVED` envelope so triggers do not run workflows, and skipping the
// delivery-dedup row so it is never suppressed. Used to force a definitions re-sync without
// simulating an inbound webhook.
export async function publishSourceCommitPushed(
  params: PublishSourceCommitPushedParams,
): Promise<void> {
  await writeOutboxEvent<IntegrationsEventMap>(db(), integrationsOutbox, {
    type: INTEGRATION_SOURCE_COMMIT_PUSHED,
    payload: {
      provider: params.provider,
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      deliveryId: params.deliveryId,
      receivedAt: params.receivedAt,
      push: params.push,
    },
  });
}

export interface RecordDeliveryOnlyParams {
  tx: Executor;
  provider: string;
  deliveryId: string;
}

export async function recordDeliveryOnly(params: RecordDeliveryOnlyParams): Promise<void> {
  await params.tx
    .insert(integrationsWebhookDeliveries)
    .values({
      provider: params.provider,
      deliveryId: params.deliveryId,
    })
    .onConflictDoNothing({
      target: [integrationsWebhookDeliveries.provider, integrationsWebhookDeliveries.deliveryId],
    });
}

export interface PruneWebhookDeliveriesParams {
  olderThan: Date;
}

export async function pruneWebhookDeliveries(
  params: PruneWebhookDeliveriesParams,
): Promise<{deleted: number}> {
  const result = await db()
    .delete(integrationsWebhookDeliveries)
    .where(lt(integrationsWebhookDeliveries.receivedAt, params.olderThan));
  return {deleted: result.rowCount ?? 0};
}

export type PublishIntegrationEventReceivedFn = typeof publishIntegrationEventReceived;
export type PublishSourcePushFn = typeof publishSourcePush;
export type PublishSourceCommitPushedFn = typeof publishSourceCommitPushed;
export type RecordDeliveryOnlyFn = typeof recordDeliveryOnly;
