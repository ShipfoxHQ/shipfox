import {Buffer} from 'node:buffer';
import type {
  GetIntegrationConnectionByIdFn,
  PublishSourcePushFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-core-dto';
import {giteaProviderKind, giteaPushPayloadSchema} from '@shipfox/api-integration-gitea-dto';
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
import {handleGiteaPush} from '#core/webhook.js';

const SIGNATURE_HEADER = 'x-gitea-signature';
const EVENT_HEADER = 'x-gitea-event';
const DELIVERY_HEADER = 'x-gitea-delivery';

export interface CreateGiteaWebhookRoutesOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export function createGiteaWebhookRoutes(options: CreateGiteaWebhookRoutesOptions): RouteGroup {
  const pushRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Gitea org webhook receiver.',
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const deliveryId = request.headers[DELIVERY_HEADER];
      const signature = request.headers[SIGNATURE_HEADER];
      const event = request.headers[EVENT_HEADER];

      if (typeof deliveryId !== 'string' || !deliveryId) {
        reply.code(400);
        return {error: 'missing X-Gitea-Delivery header'};
      }
      if (typeof signature !== 'string' || !signature) {
        reply.code(401);
        return {error: 'missing X-Gitea-Signature header'};
      }
      if (typeof event !== 'string' || !event) {
        reply.code(400);
        return {error: 'missing X-Gitea-Event header'};
      }

      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const rawBody = body.toString('utf8');

      if (!verifyHexHmacSignature({rawBody, signature, secret: config.GITEA_WEBHOOK_SECRET})) {
        reply.code(401);
        return {error: 'invalid signature'};
      }

      if (event !== 'push') {
        await options.coreDb().transaction(async (tx) => {
          await options.recordDeliveryOnly({
            tx,
            provider: giteaProviderKind,
            deliveryId,
          });
        });
        reply.code(204);
        return null;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch (error) {
        logger().warn({deliveryId, err: error}, 'gitea webhook payload JSON parse failed');
        reply.code(400);
        return {error: 'malformed JSON'};
      }

      const validated = giteaPushPayloadSchema.safeParse(parsedJson);
      if (!validated.success) {
        logger().warn(
          {deliveryId, issues: validated.error.issues},
          'gitea webhook push payload failed schema validation',
        );
        reply.code(400);
        return {error: 'malformed push payload'};
      }

      await options.coreDb().transaction(async (tx) => {
        await handleGiteaPush({
          tx,
          deliveryId,
          payload: validated.data,
          publishSourcePush: options.publishSourcePush,
          recordDeliveryOnly: options.recordDeliveryOnly,
          getIntegrationConnectionById: options.getIntegrationConnectionById,
        });
      });

      reply.code(204);
      return null;
    },
  });

  return {
    prefix: '/webhooks/integrations/gitea',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [pushRoute],
  };
}
