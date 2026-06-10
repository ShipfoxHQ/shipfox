import {
  ClientError,
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import {config} from '#config.js';
import {verifySentrySignature} from '#core/signature.js';
import {handleInstallationResource} from './installation-handler.js';
import {handleIssueResource} from './issue-handler.js';
import type {SentryWebhookContext} from './webhook-context.js';
import {recordAndDrop} from './webhook-delivery.js';
import {parseSentryWebhookRequest} from './webhook-request.js';

const ISSUE_RESOURCE = 'issue';
const INSTALLATION_RESOURCE = 'installation';

export type {SentryWebhookContext} from './webhook-context.js';

export function createSentryWebhookRoutes(context: SentryWebhookContext): RouteGroup {
  const webhookRoute = defineRoute({
    method: 'POST',
    path: '/',
    auth: [],
    description: 'Sentry integration webhook receiver.',
    options: {bodyLimit: WEBHOOK_BODY_LIMIT},
    handler: (request, reply) => {
      const {deliveryId, resource, signature, signatureHeaderName, rawBody} =
        parseSentryWebhookRequest(request);

      if (!verifySentrySignature({rawBody, signature, secret: config.SENTRY_APP_CLIENT_SECRET})) {
        throw new ClientError('invalid signature', 'invalid-signature', {status: 401});
      }
      logger().debug(
        {deliveryId, signatureHeader: signatureHeaderName},
        'sentry webhook: signature verified',
      );

      if (resource === ISSUE_RESOURCE) {
        return handleIssueResource({context, reply, deliveryId, rawBody});
      }
      if (resource === INSTALLATION_RESOURCE) {
        return handleInstallationResource({context, reply, deliveryId, rawBody});
      }

      // Unsupported resources are acknowledged so Sentry does not retry or disable the app.
      return recordAndDrop({context, reply, deliveryId});
    },
  });

  return {
    prefix: '/webhooks/integrations/sentry',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [webhookRoute],
  };
}
