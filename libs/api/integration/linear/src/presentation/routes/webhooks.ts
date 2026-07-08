import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-core-dto';
import {linearWebhookBaseEnvelopeSchema} from '@shipfox/api-integration-linear-dto';
import {
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  verifyHexHmacSignature,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {handleLinearWebhook} from '#core/webhook.js';

const DELIVERY_HEADER = 'linear-delivery';
const EVENT_HEADER = 'linear-event';
const SIGNATURE_HEADER = 'linear-signature';
const WEBHOOK_REPLAY_WINDOW_MS = 60_000;

export interface CreateLinearWebhookRoutesOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export function createLinearWebhookRoutes(options: CreateLinearWebhookRoutesOptions): RouteGroup {
  const webhookRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Linear webhook receiver.',
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const deliveryId = request.headers[DELIVERY_HEADER];
      const event = request.headers[EVENT_HEADER];
      const signature = request.headers[SIGNATURE_HEADER];

      if (typeof deliveryId !== 'string' || !deliveryId) {
        reply.code(400);
        return {error: 'missing Linear-Delivery header'};
      }
      if (typeof event !== 'string' || !event) {
        reply.code(400);
        return {error: 'missing Linear-Event header'};
      }
      if (typeof signature !== 'string' || !signature) {
        reply.code(401);
        return {error: 'missing Linear-Signature header'};
      }

      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const rawBody = body.toString('utf8');

      if (
        !verifyHexHmacSignature({
          rawBody,
          signature,
          secret: config.LINEAR_WEBHOOK_SIGNING_SECRET,
        })
      ) {
        reply.code(401);
        return {error: 'invalid signature'};
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch (error) {
        logger().warn({deliveryId, err: error}, 'linear webhook payload JSON parse failed');
        reply.code(400);
        return {error: 'malformed JSON'};
      }

      const payload = linearWebhookBaseEnvelopeSchema.safeParse(parsedJson);
      if (!payload.success) {
        logger().warn(
          {deliveryId, issues: payload.error.issues},
          'linear webhook envelope failed schema validation',
        );
        reply.code(400);
        return {error: 'malformed webhook payload'};
      }

      if (event !== payload.data.type) {
        reply.code(400);
        return {error: 'Linear-Event header does not match payload type'};
      }

      if (Math.abs(Date.now() - payload.data.webhookTimestamp) > WEBHOOK_REPLAY_WINDOW_MS) {
        reply.code(401);
        return {error: 'stale webhook timestamp'};
      }

      const signedBodyDeliveryId = createHash('sha256').update(rawBody).digest('hex');
      await options.coreDb().transaction(async (tx) => {
        await handleLinearWebhook({
          tx,
          deliveryId: signedBodyDeliveryId,
          payload: payload.data,
          rawPayload: parsedJson,
          publishIntegrationEventReceived: options.publishIntegrationEventReceived,
          recordDeliveryOnly: options.recordDeliveryOnly,
          getIntegrationConnectionById: options.getIntegrationConnectionById,
        });
      });

      reply.code(200);
      return null;
    },
  });

  return {
    prefix: '/webhooks/integrations/linear',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [webhookRoute],
  };
}
