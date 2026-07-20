import {randomUUID} from 'node:crypto';
import type {
  GetIntegrationConnectionByIdFn,
  PublishSourcePushFn,
  RecordDeliveryOnlyFn,
  StoredWebhookRequest,
  WebhookProcessingResult,
} from '@shipfox/api-integration-core-dto';
import {
  createStoredWebhookRequest,
  WEBHOOK_MAX_RAW_BODY_BYTES,
} from '@shipfox/api-integration-core-dto';
import {
  ClientError,
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {createGiteaWebhookProcessor, type GiteaWebhookProcessor} from '#core/webhook-processor.js';

const SIGNATURE_HEADER = 'x-gitea-signature';
const EVENT_HEADER = 'x-gitea-event';
const DELIVERY_HEADER = 'x-gitea-delivery';

export interface CreateGiteaWebhookRoutesOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishSourcePush: PublishSourcePushFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  processor?: GiteaWebhookProcessor | undefined;
}

export function createGiteaWebhookRoutes(options: CreateGiteaWebhookRoutesOptions): RouteGroup {
  const processor = options.processor ?? createGiteaWebhookProcessor(options);
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

      if (!(request.body instanceof Uint8Array)) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const result = await processor.process(
        createGiteaStoredWebhookRequest({
          body: request.body,
          headers: request.headers,
          rawQueryString: request.raw.url?.split('?')[1] ?? '',
        }),
      );
      return sendGiteaWebhookResponse(reply, result);
    },
  });

  return {
    prefix: '/webhooks/integrations/gitea',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [pushRoute],
  };
}

function createGiteaStoredWebhookRequest(input: {
  body: Uint8Array;
  headers: Record<string, string | string[] | undefined>;
  rawQueryString: string;
}): StoredWebhookRequest {
  if (input.body.byteLength > WEBHOOK_MAX_RAW_BODY_BYTES) {
    throw new ClientError('Webhook request body is too large', 'body-too-large', {status: 413});
  }
  try {
    return createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'gitea',
      receivedAt: new Date().toISOString(),
      rawQueryString: input.rawQueryString,
      headers: giteaWebhookHeaders(input.headers),
      body: input.body,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function giteaWebhookHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    ['content-type', DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendGiteaWebhookResponse(
  reply: {code(statusCode: number): void},
  result: WebhookProcessingResult,
) {
  if (result.outcome === 'discarded' && result.reason === 'invalid_signature') {
    reply.code(401);
    return {error: 'invalid signature'};
  }
  if (result.outcome === 'discarded' && result.reason === 'malformed_payload') {
    reply.code(400);
    return {error: 'malformed JSON'};
  }
  if (result.outcome === 'discarded' && result.reason === 'unsupported_event') {
    reply.code(400);
    return {error: 'malformed push payload'};
  }
  reply.code(204);
  return null;
}
