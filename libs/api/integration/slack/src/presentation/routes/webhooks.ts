import {randomUUID} from 'node:crypto';
import type {
  ClaimWebhookDeliveryFn,
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  StoredWebhookRequest,
} from '@shipfox/api-integration-core-dto';
import {
  createStoredWebhookRequest,
  WEBHOOK_MAX_RAW_BODY_BYTES,
} from '@shipfox/api-integration-core-dto';
import {
  ClientError,
  createRawBodyPlugin,
  defineRoute,
  type RouteGroup,
} from '@shipfox/node-fastify';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {
  createSlackWebhookProcessor,
  type SlackWebhookProcessingResult,
  type SlackWebhookProcessor,
} from '#core/webhook-processor.js';

export const SLACK_WEBHOOK_BODY_LIMIT = 1024 * 1024;
export const SLASH_COMMAND_ACK = {response_type: 'ephemeral', text: 'Working on it.'} as const;

const slackJsonRawBodyPlugin = createRawBodyPlugin({
  contentType: 'application/json',
  bodyLimit: SLACK_WEBHOOK_BODY_LIMIT,
});
const slackFormRawBodyPlugin = createRawBodyPlugin({
  contentType: 'application/x-www-form-urlencoded',
  bodyLimit: SLACK_WEBHOOK_BODY_LIMIT,
});

export interface CreateSlackWebhookRoutesOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  claimWebhookDelivery: ClaimWebhookDeliveryFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  processor?: SlackWebhookProcessor | undefined;
}

export function createSlackWebhookRoutes(options: CreateSlackWebhookRoutesOptions): RouteGroup[] {
  const processor = options.processor ?? createSlackWebhookProcessor(options);
  const eventsRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Slack Events API receiver.',
    options: {bodyLimit: SLACK_WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const body = rawRequestBody(request.body);
      if (!body) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const result = await processor.process(
        createSlackStoredWebhookRequest(
          {
            routeId: 'slack.event',
            body,
            headers: request.headers,
            rawQueryString: rawQueryString(request),
          },
          new Date().toISOString(),
        ),
      );
      return sendSlackEventResponse(reply, result);
    },
  });
  const commandsRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Slack slash-command receiver.',
    options: {bodyLimit: SLACK_WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const body = rawRequestBody(request.body);
      if (!body) {
        reply.code(400);
        return {error: 'expected raw form body'};
      }
      const result = await processor.process(
        createSlackStoredWebhookRequest(
          {
            routeId: 'slack.command',
            body,
            headers: request.headers,
            rawQueryString: rawQueryString(request),
          },
          new Date().toISOString(),
        ),
      );
      return sendSlackCommandResponse(reply, result);
    },
  });

  return [
    {
      prefix: '/webhooks/integrations/slack/events',
      auth: [],
      plugins: [slackJsonRawBodyPlugin],
      routes: [eventsRoute],
    },
    {
      prefix: '/webhooks/integrations/slack/commands',
      auth: [],
      plugins: [slackFormRawBodyPlugin],
      routes: [commandsRoute],
    },
  ];
}

function rawRequestBody(body: unknown): Uint8Array | undefined {
  return body instanceof Uint8Array ? body : undefined;
}

function rawQueryString(request: {raw: {url?: string | undefined}}): string {
  return request.raw.url?.split('?')[1] ?? '';
}

function createSlackStoredWebhookRequest(
  input: {
    routeId: 'slack.event' | 'slack.command';
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
      routeId: input.routeId,
      receivedAt,
      rawQueryString: input.rawQueryString,
      headers: slackWebhookHeaders(input.headers),
      body: input.body,
    });
  } catch (error) {
    throw new ClientError('Webhook request metadata is invalid', 'invalid-webhook-request', {
      cause: error,
    });
  }
}

function slackWebhookHeaders(headers: Record<string, string | string[] | undefined>) {
  return Object.fromEntries(
    ['content-type', 'x-slack-signature', 'x-slack-request-timestamp'].flatMap((name) => {
      const value = headers[name];
      return typeof value === 'string' ? [[name, value]] : [];
    }),
  );
}

function sendSlackEventResponse(
  reply: {code(statusCode: number): void},
  result: SlackWebhookProcessingResult,
) {
  if (result.outcome === 'processed' && 'challenge' in result) {
    reply.code(200);
    return {challenge: result.challenge};
  }
  if (
    result.outcome === 'discarded' &&
    (result.reason === 'invalid_signature' ||
      result.reason === 'missing_required_input' ||
      result.reason === 'stale_at_receipt')
  ) {
    reply.code(401);
    return {error: 'invalid signature'};
  }
  if (result.outcome === 'discarded' && result.reason === 'malformed_payload') {
    reply.code(400);
    return {error: 'malformed JSON'};
  }
  reply.code(200);
  return null;
}

function sendSlackCommandResponse(
  reply: {code(statusCode: number): void},
  result: SlackWebhookProcessingResult,
) {
  if (
    result.outcome === 'discarded' &&
    (result.reason === 'invalid_signature' ||
      result.reason === 'missing_required_input' ||
      result.reason === 'stale_at_receipt')
  ) {
    reply.code(401);
    return {error: 'invalid signature'};
  }
  reply.code(200);
  return SLASH_COMMAND_ACK;
}
