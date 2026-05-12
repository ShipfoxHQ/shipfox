import {
  INTEGRATION_REPOSITORY_PUSHED,
  type IntegrationRepositoryPushedEvent,
} from '@shipfox/api-integration-core-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {lt} from 'drizzle-orm';
import {db} from './db.js';
import {integrationsOutbox} from './schema/outbox.js';
import {integrationsWebhookDeliveries} from './schema/webhook-deliveries.js';

type IntegrationDb = ReturnType<typeof db>;
type IntegrationTx = Parameters<Parameters<IntegrationDb['transaction']>[0]>[0];
type Executor = IntegrationDb | IntegrationTx;

export interface PublishRepositoryPushedParams {
  tx: Executor;
  event: IntegrationRepositoryPushedEvent;
}

export interface PublishRepositoryPushedResult {
  published: boolean;
}

export async function publishRepositoryPushed(
  params: PublishRepositoryPushedParams,
): Promise<PublishRepositoryPushedResult> {
  const inserted = await params.tx
    .insert(integrationsWebhookDeliveries)
    .values({
      provider: params.event.provider,
      deliveryId: params.event.deliveryId,
    })
    .onConflictDoNothing({
      target: [integrationsWebhookDeliveries.provider, integrationsWebhookDeliveries.deliveryId],
    })
    .returning({deliveryId: integrationsWebhookDeliveries.deliveryId});

  if (inserted.length === 0) return {published: false};

  await writeOutboxEvent(params.tx, integrationsOutbox, {
    type: INTEGRATION_REPOSITORY_PUSHED,
    payload: params.event,
  });

  return {published: true};
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

export type PublishRepositoryPushedFn = typeof publishRepositoryPushed;
export type RecordDeliveryOnlyFn = typeof recordDeliveryOnly;
