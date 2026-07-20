import {randomUUID} from 'node:crypto';
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
import {
  createSentryWebhookProcessor,
  type SentryWebhookProcessor,
} from '#core/webhook-processor.js';
import type {SentryWebhookContext} from './webhook-context.js';

export type {SentryWebhookContext} from './webhook-context.js';

export function createSentryWebhookRoutes(
  context: SentryWebhookContext & {processor?: SentryWebhookProcessor | undefined},
): RouteGroup {
  const processor = context.processor ?? createSentryWebhookProcessor(context);
  const webhookRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Sentry integration webhook receiver.',
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const body = request.body;
      if (!(body instanceof Uint8Array)) {
        throw new ClientError('expected raw JSON body', 'invalid-body');
      }
      if (body.byteLength > WEBHOOK_MAX_RAW_BODY_BYTES) {
        throw new ClientError('Webhook request body is too large', 'body-too-large', {status: 413});
      }

      const result = await processor.process(
        createSentryStoredWebhookRequest(
          body,
          request.headers,
          request.raw.url?.split('?')[1] ?? '',
        ),
      );
      return sendSentryWebhookResponse(reply, result, request.headers);
    },
  });

  return {
    prefix: '/webhooks/integrations/sentry',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [webhookRoute],
  };
}

function createSentryStoredWebhookRequest(
  body: Uint8Array,
  headers: Record<string, string | string[] | undefined>,
  rawQueryString: string,
) {
  try {
    return createStoredWebhookRequest({
      requestId: randomUUID(),
      routeId: 'sentry',
      receivedAt: new Date().toISOString(),
      rawQueryString,
      headers: sentryWebhookHeaders(headers),
      body,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function sentryWebhookHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    [
      'content-type',
      'request-id',
      'sentry-hook-resource',
      'sentry-hook-signature',
      'sentry-app-signature',
    ].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendSentryWebhookResponse(
  reply: {code(statusCode: number): void},
  result: import('@shipfox/api-integration-core-dto').WebhookProcessingResult,
  headers: Record<string, string | string[] | undefined>,
) {
  if (result.outcome === 'discarded' && result.reason === 'invalid_signature') {
    reply.code(401);
    return {error: 'invalid signature'};
  }
  if (result.outcome === 'discarded' && result.reason === 'missing_required_input') {
    const hasSignature =
      typeof headers['sentry-hook-signature'] === 'string' ||
      typeof headers['sentry-app-signature'] === 'string';
    if (!hasSignature) {
      reply.code(401);
      return {error: 'missing signature'};
    }
    reply.code(400);
    return {error: 'missing required input'};
  }

  reply.code(204);
  return null;
}
