import {Buffer} from 'node:buffer';
import {Webhooks} from '@octokit/webhooks';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-core-dto';
import {githubPushPayloadSchema} from '@shipfox/api-integration-github-dto';
import {
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {handleGithubPush} from '#core/webhook.js';

const SIGNATURE_HEADER = 'x-hub-signature-256';
const EVENT_HEADER = 'x-github-event';
const DELIVERY_HEADER = 'x-github-delivery';
const GITHUB_PROVIDER = 'github';

export interface CreateGithubWebhookRoutesOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export function createGithubWebhookRoutes(options: CreateGithubWebhookRoutesOptions): RouteGroup {
  const webhooks = new Webhooks({secret: config.GITHUB_APP_WEBHOOK_SECRET});

  const pushRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'GitHub App webhook receiver.',
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    handler: async (request, reply) => {
      const deliveryId = request.headers[DELIVERY_HEADER];
      const signature = request.headers[SIGNATURE_HEADER];
      const event = request.headers[EVENT_HEADER];

      if (typeof deliveryId !== 'string' || !deliveryId) {
        reply.code(400);
        return {error: 'missing X-GitHub-Delivery header'};
      }
      if (typeof signature !== 'string' || !signature) {
        reply.code(401);
        return {error: 'missing X-Hub-Signature-256 header'};
      }
      if (typeof event !== 'string' || !event) {
        reply.code(400);
        return {error: 'missing X-GitHub-Event header'};
      }

      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const rawBody = body.toString('utf8');

      let verified: boolean;
      try {
        verified = await webhooks.verify(rawBody, signature);
      } catch (error) {
        logger().warn({deliveryId, err: error}, 'github webhook signature verification threw');
        verified = false;
      }
      if (!verified) {
        reply.code(401);
        return {error: 'invalid signature'};
      }

      if (event !== 'push') {
        await options.coreDb().transaction(async (tx) => {
          await options.recordDeliveryOnly({
            tx,
            provider: GITHUB_PROVIDER,
            deliveryId,
          });
        });
        reply.code(204);
        return null;
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(rawBody);
      } catch (error) {
        logger().warn({deliveryId, err: error}, 'github webhook payload JSON parse failed');
        reply.code(400);
        return {error: 'malformed JSON'};
      }

      const validated = githubPushPayloadSchema.safeParse(parsedJson);
      if (!validated.success) {
        logger().warn(
          {deliveryId, issues: validated.error.issues},
          'github webhook push payload failed schema validation',
        );
        reply.code(400);
        return {error: 'malformed push payload'};
      }

      await options.coreDb().transaction(async (tx) => {
        await handleGithubPush({
          tx,
          deliveryId,
          payload: validated.data,
          publishIntegrationEventReceived: options.publishIntegrationEventReceived,
          recordDeliveryOnly: options.recordDeliveryOnly,
          getIntegrationConnectionById: options.getIntegrationConnectionById,
        });
      });

      reply.code(204);
      return null;
    },
  });

  return {
    prefix: '/webhooks/integrations/github',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [pushRoute],
  };
}
