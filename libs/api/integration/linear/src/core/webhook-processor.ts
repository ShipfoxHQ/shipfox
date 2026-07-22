import {Buffer} from 'node:buffer';
import {
  LINEAR_PROVIDER,
  linearWebhookBaseEnvelopeSchema,
} from '@shipfox/api-integration-linear-dto';
import {
  decodeWebhookBody,
  type GetIntegrationConnectionByIdFn,
  type PublishIntegrationEventReceivedFn,
  type RecordDeliveryOnlyFn,
  type StoredWebhookRequest,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {verifyHexHmacSignature} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {handleLinearWebhook} from '#core/webhook.js';

const DELIVERY_HEADER = 'linear-delivery';
const EVENT_HEADER = 'linear-event';
const SIGNATURE_HEADER = 'linear-signature';
const WEBHOOK_REPLAY_WINDOW_MS = 60_000;

export interface CreateLinearWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export interface LinearWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

export function createLinearWebhookProcessor(
  options: CreateLinearWebhookProcessorOptions,
): LinearWebhookProcessor {
  return {process: (request) => processLinearWebhookRequest(options, request)};
}

async function processLinearWebhookRequest(
  options: CreateLinearWebhookProcessorOptions,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'linear') {
    throw new Error(`Linear processor cannot process ${request.route_id} requests`);
  }

  const deliveryId = request.headers[DELIVERY_HEADER];
  const event = request.headers[EVENT_HEADER];
  const signature = request.headers[SIGNATURE_HEADER];
  if (!deliveryId || !event || !signature) {
    return {outcome: 'discarded', reason: 'missing_required_input'};
  }

  const rawBody = Buffer.from(decodeWebhookBody(request.body));
  if (
    !verifyHexHmacSignature({
      rawBody,
      signature,
      secret: config.LINEAR_WEBHOOK_SIGNING_SECRET,
    })
  ) {
    return {outcome: 'discarded', reason: 'invalid_signature', deliveryId};
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    logger().warn({deliveryId, err: error}, 'linear webhook payload JSON parse failed');
    return {outcome: 'discarded', reason: 'malformed_payload', deliveryId};
  }

  const payload = linearWebhookBaseEnvelopeSchema.safeParse(rawPayload);
  if (!payload.success) {
    logger().warn(
      {deliveryId, issues: payload.error.issues},
      'linear webhook envelope failed schema validation',
    );
    await recordSignedDeliveryOnly(options, deliveryId);
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }

  const receivedAt = new Date(request.received_at).getTime();
  if (Math.abs(receivedAt - payload.data.webhookTimestamp) > WEBHOOK_REPLAY_WINDOW_MS) {
    return {outcome: 'discarded', reason: 'stale_at_receipt', deliveryId};
  }

  if (event !== payload.data.type) {
    logger().warn(
      {deliveryId, event, type: payload.data.type},
      'linear webhook event header did not match payload type',
    );
    await recordSignedDeliveryOnly(options, deliveryId);
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }

  const result = await options.coreDb().transaction(async (tx) =>
    handleLinearWebhook({
      tx,
      deliveryId,
      payload: payload.data,
      rawPayload,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      recordDeliveryOnly: options.recordDeliveryOnly,
      getIntegrationConnectionById: options.getIntegrationConnectionById,
    }),
  );

  if (result.outcome === 'published') return {outcome: 'processed', deliveryId};
  if (result.outcome === 'duplicate') return {outcome: 'duplicate', deliveryId};
  if (result.outcome === 'unsupported-event') {
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }
  return {outcome: 'discarded', reason: 'connection_unavailable', deliveryId};
}

async function recordSignedDeliveryOnly(
  options: Pick<CreateLinearWebhookProcessorOptions, 'coreDb' | 'recordDeliveryOnly'>,
  deliveryId: string,
): Promise<void> {
  await options.coreDb().transaction(async (tx) => {
    await options.recordDeliveryOnly({tx, provider: LINEAR_PROVIDER, deliveryId});
  });
}
