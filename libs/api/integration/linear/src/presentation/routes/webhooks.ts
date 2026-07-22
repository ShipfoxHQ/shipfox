import {randomUUID} from 'node:crypto';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  StoredWebhookRequest,
  WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest, WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {
  ClientError,
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {
  createLinearWebhookProcessor,
  type LinearWebhookProcessor,
} from '#core/webhook-processor.js';

const DELIVERY_HEADER = 'linear-delivery';
const EVENT_HEADER = 'linear-event';
const SIGNATURE_HEADER = 'linear-signature';

export interface CreateLinearWebhookRoutesOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  processor?: LinearWebhookProcessor | undefined;
}

export function createLinearWebhookRoutes(options: CreateLinearWebhookRoutesOptions): RouteGroup {
  const processor = options.processor ?? createLinearWebhookProcessor(options);
  const webhookRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Linear webhook receiver.',
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const receivedAt = new Date().toISOString();
      const deliveryHeader = request.headers[DELIVERY_HEADER];
      const event = request.headers[EVENT_HEADER];
      const signature = request.headers[SIGNATURE_HEADER];

      if (typeof deliveryHeader !== 'string' || !deliveryHeader) {
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
      if (!(body instanceof Uint8Array)) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const result = await processor.process(
        createLinearStoredWebhookRequest(
          {
            body,
            headers: request.headers,
            rawQueryString: request.raw.url?.split('?')[1] ?? '',
          },
          receivedAt,
        ),
      );

      return sendLinearWebhookResponse(reply, result);
    },
  });

  return {
    prefix: '/webhooks/integrations/linear',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [webhookRoute],
  };
}

function createLinearStoredWebhookRequest(
  input: {
    body: Uint8Array;
    headers: Record<string, string | string[] | undefined>;
    rawQueryString: string;
  },
  receivedAt: string,
): StoredWebhookRequest {
  if (input.body.byteLength > WEBHOOK_MAX_RAW_BODY_BYTES) {
    throw new ClientError('Webhook request body is too large', 'body-too-large', {status: 413});
  }

  try {
    return createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'linear',
      receivedAt,
      rawQueryString: input.rawQueryString,
      headers: linearWebhookHeaders(input.headers),
      body: input.body,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function linearWebhookHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    ['content-type', DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, 'linear-timestamp'].flatMap(
      (name) => {
        const value = headers[name];
        return typeof value === 'string' ? [[name, value]] : [];
      },
    ),
  );
}

function sendLinearWebhookResponse(
  reply: {code(statusCode: number): void},
  result: WebhookProcessingResult,
) {
  if (result.outcome !== 'discarded') {
    reply.code(200);
    return null;
  }

  if (result.reason === 'invalid_signature') {
    reply.code(401);
    return {error: 'invalid signature'};
  }
  if (result.reason === 'stale_at_receipt') {
    reply.code(401);
    return {error: 'stale webhook timestamp'};
  }
  if (result.reason === 'malformed_payload') {
    reply.code(400);
    return {error: 'malformed JSON'};
  }

  reply.code(200);
  return null;
}
