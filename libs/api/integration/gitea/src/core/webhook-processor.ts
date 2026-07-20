import {Buffer} from 'node:buffer';
import {
  decodeWebhookBody,
  type GetIntegrationConnectionByIdFn,
  type PublishSourcePushFn,
  type RecordDeliveryOnlyFn,
  type StoredWebhookRequest,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-core-dto';
import {verifyHexHmacSignature} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {
  GiteaWebhookMalformedJsonError,
  GiteaWebhookMalformedPushPayloadError,
  handleGiteaWebhook,
} from '#core/webhook.js';

const DELIVERY_HEADER = 'x-gitea-delivery';
const EVENT_HEADER = 'x-gitea-event';
const SIGNATURE_HEADER = 'x-gitea-signature';

export interface CreateGiteaWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export interface GiteaWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

export function createGiteaWebhookProcessor(
  options: CreateGiteaWebhookProcessorOptions,
): GiteaWebhookProcessor {
  return {process: (request) => processGiteaWebhookRequest(options, request)};
}

async function processGiteaWebhookRequest(
  options: CreateGiteaWebhookProcessorOptions,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'gitea') {
    throw new Error(`Gitea processor cannot process ${request.route_id} requests`);
  }

  const deliveryId = request.headers[DELIVERY_HEADER];
  const event = request.headers[EVENT_HEADER];
  const signature = request.headers[SIGNATURE_HEADER];
  if (!deliveryId || !event || !signature) {
    return {outcome: 'discarded', reason: 'missing_required_input'};
  }

  const rawBody = Buffer.from(decodeWebhookBody(request.body));
  if (!verifyHexHmacSignature({rawBody, signature, secret: config.GITEA_WEBHOOK_SECRET})) {
    return {outcome: 'discarded', reason: 'invalid_signature', deliveryId};
  }

  try {
    const result = await options.coreDb().transaction(async (tx) =>
      handleGiteaWebhook({
        tx,
        deliveryId,
        event,
        rawBody: rawBody.toString('utf8'),
        publishSourcePush: options.publishSourcePush,
        recordDeliveryOnly: options.recordDeliveryOnly,
        getIntegrationConnectionById: options.getIntegrationConnectionById,
      }),
    );
    return result.outcome === 'duplicate'
      ? {outcome: 'duplicate', deliveryId}
      : {outcome: 'processed', deliveryId};
  } catch (error) {
    if (error instanceof GiteaWebhookMalformedJsonError) {
      logger().warn({deliveryId, err: error}, 'gitea webhook payload JSON parse failed');
      return {outcome: 'discarded', reason: 'malformed_payload', deliveryId};
    }
    if (error instanceof GiteaWebhookMalformedPushPayloadError) {
      logger().warn(
        {deliveryId, issues: error.issues},
        'gitea webhook push payload failed schema validation',
      );
      return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
    }
    throw error;
  }
}
