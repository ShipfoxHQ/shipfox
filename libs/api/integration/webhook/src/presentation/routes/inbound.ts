import {randomUUID} from 'node:crypto';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
} from '@shipfox/api-integration-core-dto';
import {
  createStoredWebhookRequest,
  type StoredWebhookRequest,
  WEBHOOK_MAX_RAW_BODY_BYTES,
} from '@shipfox/api-integration-core-dto';
import {WEBHOOK_PROVIDER} from '@shipfox/api-integration-webhook-dto';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {FastifyPluginAsync} from 'fastify';
import fp from 'fastify-plugin';
import {z} from 'zod';
import {WEBHOOK_ACCEPTED_CONTENT_TYPES, WEBHOOK_INBOUND_BODY_LIMIT} from '#constants.js';
import {
  createGenericWebhookProcessor,
  type GenericWebhookProcessor,
} from '#core/webhook-processor.js';

const MAX_DELIVERY_ID_HEADER_LENGTH = 200;
const acceptedContentTypes = new Set<string>(WEBHOOK_ACCEPTED_CONTENT_TYPES);
const rawWebhookBodyPlugin: FastifyPluginAsync = fp((app) => {
  app.removeAllContentTypeParsers();
  for (const contentType of acceptedContentTypes) {
    app.addContentTypeParser(
      contentType,
      {parseAs: 'buffer', bodyLimit: WEBHOOK_INBOUND_BODY_LIMIT},
      (_request, body, done) => {
        done(null, body);
      },
    );
  }
  return Promise.resolve();
});

export interface CreateWebhookInboundRoutesOptions {
  coreDb: () => {
    transaction<T>(callback: (tx: IntegrationTx) => Promise<T>): Promise<T>;
  };
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  processor?: GenericWebhookProcessor | undefined;
}

const inboundParamsSchema = z.object({
  connectionId: z.string().uuid(),
});

const inboundQuerySchema = z.record(z.string(), z.unknown());

const inboundAcceptedResponseSchema = z.object({
  delivery_id: z.string(),
});

function contentType(requestContentType: string | undefined): string | undefined {
  return requestContentType?.split(';', 1)[0]?.trim().toLowerCase();
}

function deliveryIdFor(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return randomUUID();
  if (value.length > MAX_DELIVERY_ID_HEADER_LENGTH) {
    throw new ClientError('Delivery ID header is too long', 'delivery-id-too-long', {status: 400});
  }
  return value;
}

function hasDeliveryId(header: string | string[] | undefined): boolean {
  return Boolean(Array.isArray(header) ? header[0] : header);
}

export function createWebhookInboundRoutes(options: CreateWebhookInboundRoutesOptions): RouteGroup {
  const processor = options.processor ?? createGenericWebhookProcessor(options);
  const inboundRoute = defineRoute({
    method: 'POST',
    path: '/:connectionId',
    auth: [],
    description: 'Generic webhook receiver.',
    options: {bodyLimit: WEBHOOK_INBOUND_BODY_LIMIT},
    schema: {
      params: inboundParamsSchema,
      querystring: inboundQuerySchema,
      response: {
        202: inboundAcceptedResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const mediaType = contentType(request.headers['content-type']);
      if (!mediaType || !acceptedContentTypes.has(mediaType)) {
        throw new ClientError('Unsupported content type', 'unsupported-media-type', {status: 415});
      }

      const {connectionId} = request.params;
      const connection = await options.getIntegrationConnectionById(connectionId);
      if (
        !connection ||
        connection.provider !== WEBHOOK_PROVIDER ||
        connection.lifecycleStatus !== 'active'
      ) {
        throw new ClientError('Webhook connection not found', 'not-found', {status: 404});
      }

      const deliveryHeader = request.headers['x-delivery-id'];
      const deliveryId = deliveryIdFor(deliveryHeader);
      const result = await processor.process(
        createGenericStoredWebhookRequest(
          {
            body: request.body,
            connectionId,
            headers: request.headers,
            rawQueryString: request.raw.url?.split('?')[1] ?? '',
            requestId: hasDeliveryId(deliveryHeader) ? randomUUID() : deliveryId,
          },
          new Date().toISOString(),
        ),
        connection,
      );

      if (result.outcome === 'discarded' && result.reason === 'malformed_payload') {
        throw new ClientError('Malformed webhook payload', 'malformed-payload', {status: 400});
      }

      reply.code(202);
      return {delivery_id: deliveryId};
    },
  });

  return {
    prefix: '/webhook',
    auth: [],
    plugins: [rawWebhookBodyPlugin],
    routes: [inboundRoute],
  };
}

function createGenericStoredWebhookRequest(
  input: {
    body: unknown;
    connectionId: string;
    headers: Record<string, string | string[] | undefined>;
    rawQueryString: string;
    requestId: string;
  },
  receivedAt: string,
): StoredWebhookRequest {
  if (!(input.body instanceof Uint8Array)) {
    throw new ClientError('Expected raw webhook body', 'invalid-webhook-request', {status: 400});
  }
  if (input.body.byteLength > WEBHOOK_MAX_RAW_BODY_BYTES) {
    throw new ClientError('Webhook request body is too large', 'body-too-large', {status: 413});
  }

  try {
    return createStoredWebhookRequest({
      requestId: input.requestId,
      routeId: 'webhook.connection',
      receivedAt,
      rawQueryString: input.rawQueryString,
      headers: webhookHeaders(input.headers),
      body: input.body,
      connectionId: input.connectionId,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function webhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => {
      if (value === undefined) return [];
      return [[name.toLowerCase(), Array.isArray(value) ? value.join(', ') : value]];
    }),
  );
}
