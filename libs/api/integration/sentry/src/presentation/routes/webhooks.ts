import {
  sentryInstallationWebhookSchema,
  sentryIssueWebhookSchema,
} from '@shipfox/api-integration-sentry-dto';
import {
  ClientError,
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {FastifyReply} from 'fastify';
import type {z} from 'zod';
import {config} from '#config.js';
import {verifySentrySignature} from '#core/signature.js';
import {
  type GetIntegrationConnectionByIdFn,
  handleSentryInstallationLifecycle,
  handleSentryIssueEvent,
  normalizeSentryIssueAction,
  type PublishIntegrationEventReceivedFn,
  type RecordDeliveryOnlyFn,
  type UpdateConnectionLifecycleStatusFn,
} from '#core/webhook.js';
import {parseSentryWebhookRequest} from './webhook-request.js';

const SENTRY_PROVIDER = 'sentry';
const ISSUE_RESOURCE = 'issue';
const INSTALLATION_RESOURCE = 'installation';

export interface CreateSentryWebhookRoutesOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateConnectionLifecycleStatus: UpdateConnectionLifecycleStatusFn;
}

export function createSentryWebhookRoutes(options: CreateSentryWebhookRoutesOptions): RouteGroup {
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
        return handleIssueResource({options, reply, deliveryId, rawBody});
      }
      if (resource === INSTALLATION_RESOURCE) {
        return handleInstallationResource({options, reply, deliveryId, rawBody});
      }

      // Unsupported resources are acknowledged so Sentry does not retry or disable the app.
      return recordAndDrop({options, reply, deliveryId});
    },
  });

  return {
    prefix: '/webhooks/integrations/sentry',
    auth: [],
    plugins: [rawBodyPlugin],
    routes: [webhookRoute],
  };
}

async function handleIssueResource(args: {
  options: CreateSentryWebhookRoutesOptions;
  reply: FastifyReply;
  deliveryId: string;
  rawBody: string;
}): Promise<null> {
  const {options, reply, deliveryId, rawBody} = args;

  const payload = await parseAndValidateOrDrop({
    schema: sentryIssueWebhookSchema,
    normalize: normalizeSentryIssueAction,
    rawBody,
    deliveryId,
    options,
    reply,
  });
  if (!payload) return null;

  await options.coreDb().transaction(async (tx) => {
    await handleSentryIssueEvent({
      tx,
      deliveryId,
      payload,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      recordDeliveryOnly: options.recordDeliveryOnly,
      getIntegrationConnectionById: options.getIntegrationConnectionById,
    });
  });

  reply.code(204);
  return null;
}

async function handleInstallationResource(args: {
  options: CreateSentryWebhookRoutesOptions;
  reply: FastifyReply;
  deliveryId: string;
  rawBody: string;
}): Promise<null> {
  const {options, reply, deliveryId, rawBody} = args;

  const payload = await parseAndValidateOrDrop({
    schema: sentryInstallationWebhookSchema,
    rawBody,
    deliveryId,
    options,
    reply,
  });
  if (!payload) return null;

  await options.coreDb().transaction(async (tx) => {
    await handleSentryInstallationLifecycle({
      tx,
      deliveryId,
      action: payload.action,
      installationUuid: payload.installation.uuid,
      recordDeliveryOnly: options.recordDeliveryOnly,
      updateConnectionLifecycleStatus: options.updateConnectionLifecycleStatus,
    });
  });

  reply.code(204);
  return null;
}

// Parses and validates a delivery body, recording-and-dropping it (HTTP 204) when
// the JSON is malformed or fails the schema (an unknown action falls here too).
// Returns the validated payload, or null when the delivery was dropped.
async function parseAndValidateOrDrop<TSchema extends z.ZodType>(args: {
  schema: TSchema;
  rawBody: string;
  deliveryId: string;
  options: CreateSentryWebhookRoutesOptions;
  reply: FastifyReply;
  normalize?: (parsedJson: unknown) => unknown;
}): Promise<z.infer<TSchema> | null> {
  const {schema, rawBody, deliveryId, options, reply, normalize} = args;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch (error) {
    logger().warn({deliveryId, err: error}, 'sentry webhook: payload JSON parse failed, dropping');
    await recordAndDrop({options, reply, deliveryId});
    return null;
  }

  const validated = schema.safeParse(normalize ? normalize(parsedJson) : parsedJson);
  if (!validated.success) {
    logger().warn(
      {deliveryId, issues: validated.error.issues},
      'sentry webhook: payload failed validation (or unknown action), dropping',
    );
    await recordAndDrop({options, reply, deliveryId});
    return null;
  }

  return validated.data;
}

// Records the delivery for dedup and replies 204 without acting on it. A sustained
// non-2xx can degrade or disable the webhook on Sentry's side (a deliberate
// deviation from GitHub's 400), so deliveries we cannot use are acknowledged.
async function recordAndDrop(args: {
  options: CreateSentryWebhookRoutesOptions;
  reply: FastifyReply;
  deliveryId: string;
}): Promise<null> {
  const {options, reply, deliveryId} = args;
  await options.coreDb().transaction(async (tx) => {
    await options.recordDeliveryOnly({tx, provider: SENTRY_PROVIDER, deliveryId});
  });
  reply.code(204);
  return null;
}
