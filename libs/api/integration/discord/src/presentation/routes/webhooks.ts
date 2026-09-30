import {randomUUID} from 'node:crypto';
import type {StoredWebhookRequest} from '@shipfox/api-integration-spi';
import {createStoredWebhookRequest, WEBHOOK_MAX_RAW_BODY_BYTES} from '@shipfox/api-integration-spi';
import {
  ClientError,
  createRawBodyPlugin,
  defineRoute,
  type RouteGroup,
} from '@shipfox/node-fastify';
import {
  type CreateDiscordWebhookProcessorOptions,
  createDiscordWebhookProcessor,
  DISCORD_SIGNATURE_HEADER,
  DISCORD_TIMESTAMP_HEADER,
  type DiscordInteractionProcessingResult,
  type DiscordWebhookProcessor,
} from '#core/webhook-processor.js';

const discordRawBodyPlugin = createRawBodyPlugin({
  contentType: 'application/json',
  bodyLimit: WEBHOOK_MAX_RAW_BODY_BYTES,
});

export interface CreateDiscordWebhookRoutesOptions extends CreateDiscordWebhookProcessorOptions {
  processor?: DiscordWebhookProcessor | undefined;
}

export function createDiscordWebhookRoutes(options: CreateDiscordWebhookRoutesOptions): RouteGroup {
  const processor = options.processor ?? createDiscordWebhookProcessor(options);
  const route = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Discord interactions receiver.',
    options: {bodyLimit: WEBHOOK_MAX_RAW_BODY_BYTES},
    handler: async (request, reply) => {
      const body = request.body;
      if (!(body instanceof Uint8Array)) {
        throw new ClientError('Expected raw JSON body', 'invalid-webhook-request', {status: 400});
      }

      const processed = await processor.processInteraction(
        createDiscordStoredWebhookRequest({
          body,
          headers: request.headers,
          rawQueryString: rawQueryString(request),
        }),
      );
      return sendDiscordInteractionResponse(reply, processed);
    },
  });

  return {
    prefix: '/webhooks/integrations/discord/interactions',
    auth: [],
    plugins: [discordRawBodyPlugin],
    routes: [route],
  };
}

function rawQueryString(request: {raw: {url?: string | undefined}}): string {
  return request.raw.url?.split('?')[1] ?? '';
}

function createDiscordStoredWebhookRequest(input: {
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
      routeId: 'discord.interaction',
      receivedAt: new Date().toISOString(),
      rawQueryString: input.rawQueryString,
      headers: discordWebhookHeaders(input.headers),
      body: input.body,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function discordWebhookHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    ['content-type', DISCORD_SIGNATURE_HEADER, DISCORD_TIMESTAMP_HEADER].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendDiscordInteractionResponse(
  reply: {code(statusCode: number): void},
  {result, response}: DiscordInteractionProcessingResult,
) {
  if (result.outcome === 'discarded') {
    if (
      result.reason === 'invalid_signature' ||
      result.reason === 'missing_required_input' ||
      result.reason === 'stale_at_receipt'
    ) {
      reply.code(401);
      return {error: 'invalid signature'};
    }
    if (result.reason === 'malformed_payload') {
      reply.code(400);
      return {error: 'malformed interaction'};
    }
  }

  reply.code(200);
  return response ?? null;
}
