import type {Buffer} from 'node:buffer';
import {randomUUID} from 'node:crypto';
import formBodyPlugin from '@fastify/formbody';
import type {
  GetIntegrationConnectionByIdFn,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
} from '@shipfox/api-integration-core-dto';
import {WEBHOOK_PROVIDER, WEBHOOK_RECEIVED_EVENT} from '@shipfox/api-integration-webhook-dto';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {FastifyPluginAsync} from 'fastify';
import fp from 'fastify-plugin';
import {z} from 'zod';
import {redactHeaders, WEBHOOK_INBOUND_BODY_LIMIT} from '#constants.js';

const MAX_DELIVERY_ID_HEADER_LENGTH = 200;
const acceptedContentTypes = new Set([
  'application/json',
  'application/x-www-form-urlencoded',
  'text/plain',
]);
const FORM_URLENCODED_CONTENT_TYPE_RE = /^application\/x-www-form-urlencoded(?:;.*)?$/i;

const formBodyRoutePlugin: FastifyPluginAsync = fp(async (app) => {
  await app.register(formBodyPlugin, {bodyLimit: WEBHOOK_INBOUND_BODY_LIMIT});

  app.addContentTypeParser(
    FORM_URLENCODED_CONTENT_TYPE_RE,
    {parseAs: 'buffer', bodyLimit: WEBHOOK_INBOUND_BODY_LIMIT},
    (_request, body: Buffer, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body.toString('utf8'))));
    },
  );
});

export interface CreateWebhookInboundRoutesOptions {
  coreDb: () => {
    transaction<T>(callback: (tx: IntegrationTx) => Promise<T>): Promise<T>;
  };
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
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

export function createWebhookInboundRoutes(options: CreateWebhookInboundRoutesOptions): RouteGroup {
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

      const deliveryId = deliveryIdFor(request.headers['x-delivery-id']);
      const receivedAt = new Date().toISOString();
      await options.coreDb().transaction(async (tx) => {
        await options.publishIntegrationEventReceived({
          tx,
          event: {
            provider: WEBHOOK_PROVIDER,
            source: connection.externalAccountId,
            event: WEBHOOK_RECEIVED_EVENT,
            workspaceId: connection.workspaceId,
            connectionId: connection.id,
            connectionName: connection.displayName,
            deliveryId,
            receivedAt,
            payload: {
              method: request.method,
              headers: redactHeaders(request.headers),
              query: request.query,
              body: request.body,
            },
          },
        });
      });

      reply.code(202);
      return {delivery_id: deliveryId};
    },
  });

  return {
    prefix: '/webhook',
    auth: [],
    plugins: [formBodyRoutePlugin],
    routes: [inboundRoute],
  };
}
