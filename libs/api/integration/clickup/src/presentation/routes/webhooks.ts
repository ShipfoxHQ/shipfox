import {randomUUID} from 'node:crypto';
import type {StoredWebhookRequest, WebhookProcessingResult} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest, WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {
  ClientError,
  createRawBodyPlugin,
  defineRoute,
  type RouteGroup,
} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  type ClickUpWebhookProcessor,
  type CreateClickUpWebhookProcessorOptions,
  createClickUpWebhookProcessor,
} from '#core/webhook-processor.js';
import {CLICKUP_WEBHOOK_ROUTE_PREFIX} from '#core/webhook-url.js';

const clickupWebhookParamsSchema = z.object({connectionId: z.string().uuid()});
const clickupRawBodyPlugin = createRawBodyPlugin({
  contentType: 'application/json',
  bodyLimit: WEBHOOK_MAX_RAW_BODY_BYTES,
});

export {CLICKUP_WEBHOOK_ROUTE_PREFIX};

export interface CreateClickUpWebhookRoutesOptions extends CreateClickUpWebhookProcessorOptions {
  processor?: ClickUpWebhookProcessor | undefined;
}

export function createClickUpWebhookRoutes(options: CreateClickUpWebhookRoutesOptions): RouteGroup {
  const processor = options.processor ?? createClickUpWebhookProcessor(options);
  const route = defineRoute({
    method: 'POST',
    path: '/:connectionId',
    auth: [],
    description: 'ClickUp webhook receiver.',
    options: {bodyLimit: WEBHOOK_MAX_RAW_BODY_BYTES},
    schema: {params: clickupWebhookParamsSchema},
    handler: async (request, reply) => {
      const body = request.body;
      if (!(body instanceof Uint8Array)) {
        throw new ClientError('Expected raw JSON body', 'invalid-webhook-request', {status: 400});
      }
      const result = await processor.process(
        createClickUpStoredWebhookRequest({
          body,
          connectionId: request.params.connectionId,
          headers: request.headers,
          rawQueryString: clickupRawQueryString(request),
        }),
      );
      return sendClickUpWebhookResponse(reply, result);
    },
  });

  return {
    prefix: CLICKUP_WEBHOOK_ROUTE_PREFIX,
    auth: [],
    plugins: [clickupRawBodyPlugin],
    routes: [route],
  };
}

function clickupRawQueryString(request: {raw: {url?: string | undefined}}): string {
  const url = request.raw.url;
  const querySeparatorIndex = url?.indexOf('?') ?? -1;
  return querySeparatorIndex === -1 || url === undefined ? '' : url.slice(querySeparatorIndex + 1);
}

function createClickUpStoredWebhookRequest(input: {
  body: Uint8Array;
  connectionId: string;
  headers: Record<string, string | string[] | undefined>;
  rawQueryString: string;
}): StoredWebhookRequest {
  if (input.body.byteLength > WEBHOOK_MAX_RAW_BODY_BYTES) {
    throw new ClientError('Webhook request body is too large', 'body-too-large', {status: 413});
  }
  try {
    return createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'clickup',
      receivedAt: new Date().toISOString(),
      rawQueryString: input.rawQueryString,
      headers: clickupWebhookHeaders(input.headers),
      body: input.body,
      connectionId: input.connectionId,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function clickupWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    ['content-type', 'x-signature'].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendClickUpWebhookResponse(
  reply: {code(statusCode: number): void},
  result: WebhookProcessingResult,
) {
  if (result.outcome !== 'discarded') {
    reply.code(200);
    return null;
  }
  if (result.reason === 'invalid_signature' || result.reason === 'missing_required_input') {
    reply.code(403);
    return {error: 'invalid signature'};
  }
  if (result.reason === 'malformed_payload') {
    reply.code(400);
    return {error: 'malformed JSON'};
  }
  if (result.reason === 'connection_unavailable' && result.deliveryId === undefined) {
    reply.code(410);
    return null;
  }
  reply.code(200);
  return null;
}
