import {Buffer} from 'node:buffer';
import type {
  ClaimWebhookDeliveryFn,
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-core-dto';
import {
  slackEventsRequestSchema,
  slackSlashCommandSchema,
} from '@shipfox/api-integration-slack-dto';
import {createRawBodyPlugin, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {verifySlackSignature} from '#core/signature.js';
import {handleSlackCommand, handleSlackEvent} from '#core/webhook.js';

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
}

export function createSlackWebhookRoutes(options: CreateSlackWebhookRoutesOptions): RouteGroup[] {
  const eventsRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Slack Events API receiver.',
    options: {bodyLimit: SLACK_WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const rawBody = rawRequestBody(request.body);
      if (rawBody === undefined) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      if (!hasValidSlackSignature(request.headers, rawBody)) {
        reply.code(401);
        return {error: 'invalid signature'};
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch (error) {
        logger().warn(
          {errorName: error instanceof Error ? error.name : 'unknown'},
          'slack events payload JSON parse failed',
        );
        reply.code(400);
        return {error: 'malformed JSON'};
      }

      const parsed = slackEventsRequestSchema.safeParse(parsedJson);
      if (!parsed.success) {
        logger().warn(
          {issues: parsed.error.issues},
          'slack events envelope failed schema validation',
        );
        reply.code(200);
        return null;
      }
      const eventRequest = parsed.data;
      if (eventRequest.type === 'url_verification') {
        reply.code(200);
        return {challenge: eventRequest.challenge};
      }

      await options.coreDb().transaction(async (tx) => {
        await handleSlackEvent({
          tx,
          deliveryId: eventRequest.event_id,
          envelope: eventRequest,
          claimWebhookDelivery: options.claimWebhookDelivery,
          publishIntegrationEventReceived: options.publishIntegrationEventReceived,
          recordDeliveryOnly: options.recordDeliveryOnly,
          getIntegrationConnectionById: options.getIntegrationConnectionById,
        });
      });
      reply.code(200);
      return null;
    },
  });

  const commandsRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Slack slash-command receiver.',
    options: {bodyLimit: SLACK_WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const rawBody = rawRequestBody(request.body);
      if (rawBody === undefined) {
        reply.code(400);
        return {error: 'expected raw form body'};
      }
      if (!hasValidSlackSignature(request.headers, rawBody)) {
        reply.code(401);
        return {error: 'invalid signature'};
      }

      const command = slackSlashCommandSchema.safeParse(
        Object.fromEntries(new URLSearchParams(rawBody)),
      );
      if (!command.success) {
        logger().warn({issues: command.error.issues}, 'slack command failed schema validation');
        reply.code(200);
        return SLASH_COMMAND_ACK;
      }

      await options.coreDb().transaction(async (tx) => {
        await handleSlackCommand({
          tx,
          deliveryId: command.data.trigger_id,
          command: command.data,
          publishIntegrationEventReceived: options.publishIntegrationEventReceived,
          recordDeliveryOnly: options.recordDeliveryOnly,
          getIntegrationConnectionById: options.getIntegrationConnectionById,
        });
      });
      reply.code(200);
      return SLASH_COMMAND_ACK;
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

function rawRequestBody(body: unknown): string | undefined {
  return Buffer.isBuffer(body) ? body.toString('utf8') : undefined;
}

function hasValidSlackSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
): boolean {
  const signature = headers['x-slack-signature'];
  const timestamp = headers['x-slack-request-timestamp'];
  return verifySlackSignature({
    signingSecret: config.SLACK_SIGNING_SECRET,
    signature: typeof signature === 'string' ? signature : undefined,
    timestamp: typeof timestamp === 'string' ? timestamp : undefined,
    rawBody,
  });
}
