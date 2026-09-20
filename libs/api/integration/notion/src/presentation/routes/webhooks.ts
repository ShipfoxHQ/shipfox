import {randomUUID} from 'node:crypto';
import type {StoredWebhookRequest, WebhookProcessingResult} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest, WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {
  ClientError,
  createRawBodyPlugin,
  defineRoute,
  type RouteGroup,
} from '@shipfox/node-fastify';
import {
  type CreateNotionWebhookProcessorOptions,
  createNotionWebhookProcessor,
  type NotionWebhookProcessor,
} from '#core/webhook-processor.js';

const SIGNATURE_HEADER = 'x-notion-signature';
const notionRawBodyPlugin = createRawBodyPlugin({
  contentType: 'application/json',
  bodyLimit: WEBHOOK_MAX_RAW_BODY_BYTES,
});

export interface CreateNotionWebhookRoutesOptions extends CreateNotionWebhookProcessorOptions {
  processor?: NotionWebhookProcessor | undefined;
}

export function createNotionWebhookRoutes(options: CreateNotionWebhookRoutesOptions): RouteGroup {
  const processor = options.processor ?? createNotionWebhookProcessor(options);
  const route = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Notion webhook receiver.',
    options: {bodyLimit: WEBHOOK_MAX_RAW_BODY_BYTES},
    handler: async (request, reply) => {
      const body = request.body;
      if (!(body instanceof Uint8Array)) {
        throw new ClientError('Expected raw JSON body', 'invalid-webhook-request', {status: 400});
      }

      const result = await processor.process(
        createNotionStoredWebhookRequest({
          body,
          headers: request.headers,
          rawQueryString: notionRawQueryString(request),
        }),
      );
      return sendNotionWebhookResponse(reply, result);
    },
  });

  return {
    prefix: '/webhooks/integrations/notion',
    auth: [],
    plugins: [notionRawBodyPlugin],
    routes: [route],
  };
}

function notionRawQueryString(request: {raw: {url?: string | undefined}}): string {
  const url = request.raw.url;
  const querySeparatorIndex = url?.indexOf('?') ?? -1;
  return querySeparatorIndex === -1 || url === undefined ? '' : url.slice(querySeparatorIndex + 1);
}

function createNotionStoredWebhookRequest(input: {
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
      routeId: 'notion',
      receivedAt: new Date().toISOString(),
      rawQueryString: input.rawQueryString,
      headers: notionWebhookHeaders(input.headers),
      body: input.body,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function notionWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    ['content-type', SIGNATURE_HEADER].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendNotionWebhookResponse(
  reply: {code(statusCode: number): void},
  result: WebhookProcessingResult,
) {
  if (result.outcome !== 'discarded') {
    reply.code(200);
    return null;
  }

  if (result.reason === 'invalid_signature' || result.reason === 'missing_required_input') {
    reply.code(401);
    return {error: 'invalid signature'};
  }
  if (result.reason === 'malformed_payload') {
    reply.code(400);
    return {error: 'malformed JSON'};
  }

  reply.code(200);
  return null;
}
