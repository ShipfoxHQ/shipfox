import {Buffer} from 'node:buffer';
import {createHmac, timingSafeEqual} from 'node:crypto';
import {
  sentryInstallationWebhookSchema,
  sentryIssueWebhookSchema,
} from '@shipfox/api-integration-sentry-dto';
import {
  defineRoute,
  type RouteGroup,
  rawBodyPlugin,
  WEBHOOK_BODY_LIMIT,
} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {
  type GetIntegrationConnectionByIdFn,
  handleSentryInstallationLifecycle,
  handleSentryIssueEvent,
  type PublishIntegrationEventReceivedFn,
  type RecordDeliveryOnlyFn,
  type UpdateConnectionLifecycleStatusFn,
} from '#core/webhook.js';

const REQUEST_ID_HEADER = 'request-id';
const RESOURCE_HEADER = 'sentry-hook-resource';
const SIGNATURE_HEADER = 'sentry-hook-signature';
// Sentry has used both header names; accepting both keeps older deliveries verifiable.
const LEGACY_SIGNATURE_HEADER = 'sentry-app-signature';
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
    handler: async (request, reply) => {
      const deliveryId = request.headers[REQUEST_ID_HEADER];
      const resource = request.headers[RESOURCE_HEADER];
      const signatureHeader = request.headers[SIGNATURE_HEADER];
      const legacySignatureHeader = request.headers[LEGACY_SIGNATURE_HEADER];

      if (typeof deliveryId !== 'string' || !deliveryId) {
        reply.code(400);
        return {error: 'missing Request-ID header'};
      }
      if (typeof resource !== 'string' || !resource) {
        reply.code(400);
        return {error: 'missing Sentry-Hook-Resource header'};
      }

      const signature =
        typeof signatureHeader === 'string' && signatureHeader
          ? signatureHeader
          : typeof legacySignatureHeader === 'string' && legacySignatureHeader
            ? legacySignatureHeader
            : undefined;
      if (!signature) {
        reply.code(401);
        return {error: 'missing Sentry-Hook-Signature header'};
      }

      const body = request.body;
      if (!Buffer.isBuffer(body)) {
        reply.code(400);
        return {error: 'expected raw JSON body'};
      }
      const rawBody = body.toString('utf8');

      if (!verifySignature(rawBody, signature)) {
        reply.code(401);
        return {error: 'invalid signature'};
      }
      logger().debug(
        {
          deliveryId,
          signatureHeader:
            typeof signatureHeader === 'string' ? SIGNATURE_HEADER : LEGACY_SIGNATURE_HEADER,
        },
        'sentry webhook: signature verified',
      );

      if (resource === ISSUE_RESOURCE) {
        return handleIssueResource({options, reply, deliveryId, rawBody});
      }

      if (resource === INSTALLATION_RESOURCE) {
        return handleInstallationResource({options, reply, deliveryId, rawBody});
      }

      // Unsupported resources are acknowledged so Sentry does not retry or disable the app.
      await recordOnly(options, deliveryId);
      reply.code(204);
      return null;
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
  // biome-ignore lint/suspicious/noExplicitAny: fastify reply
  reply: any;
  deliveryId: string;
  rawBody: string;
}): Promise<null> {
  const {options, reply, deliveryId, rawBody} = args;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch (error) {
    // Deliberate deviation from GitHub's 400: a sustained non-2xx can degrade or
    // disable the webhook on Sentry's side, so malformed input is recorded-and-dropped.
    logger().warn(
      {deliveryId, err: error},
      'sentry webhook: issue payload JSON parse failed, dropping',
    );
    await recordOnly(options, deliveryId);
    reply.code(204);
    return null;
  }

  const validated = sentryIssueWebhookSchema.safeParse(normalizeIssueAction(parsedJson));
  if (!validated.success) {
    logger().warn(
      {deliveryId, issues: validated.error.issues},
      'sentry webhook: issue payload failed validation (or unknown action), dropping',
    );
    await recordOnly(options, deliveryId);
    reply.code(204);
    return null;
  }

  await options.coreDb().transaction(async (tx) => {
    await handleSentryIssueEvent({
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
}

async function handleInstallationResource(args: {
  options: CreateSentryWebhookRoutesOptions;
  // biome-ignore lint/suspicious/noExplicitAny: fastify reply
  reply: any;
  deliveryId: string;
  rawBody: string;
}): Promise<null> {
  const {options, reply, deliveryId, rawBody} = args;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch (error) {
    logger().warn(
      {deliveryId, err: error},
      'sentry webhook: installation payload JSON parse failed, dropping',
    );
    await recordOnly(options, deliveryId);
    reply.code(204);
    return null;
  }

  const validated = sentryInstallationWebhookSchema.safeParse(parsedJson);
  if (!validated.success) {
    // Future installation actions should not make Sentry retry a delivery we cannot use.
    logger().warn(
      {deliveryId, issues: validated.error.issues},
      'sentry webhook: installation payload failed validation (or unknown action), dropping',
    );
    await recordOnly(options, deliveryId);
    reply.code(204);
    return null;
  }

  await options.coreDb().transaction(async (tx) => {
    await handleSentryInstallationLifecycle({
      tx,
      deliveryId,
      action: validated.data.action,
      installationUuid: validated.data.installation.uuid,
      recordDeliveryOnly: options.recordDeliveryOnly,
      updateConnectionLifecycleStatus: options.updateConnectionLifecycleStatus,
    });
  });

  reply.code(204);
  return null;
}

function verifySignature(rawBody: string, signature: string): boolean {
  const expected = createHmac('sha256', config.SENTRY_APP_CLIENT_SECRET)
    .update(rawBody)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(signature, 'utf8');
  // timingSafeEqual throws on length mismatch — guard so a garbage signature is a
  // clean 401, not a 500.
  if (expectedBuf.length !== providedBuf.length) return false;
  try {
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}

// A raw Sentry `ignored` action is normalized to `archived` before validation,
// so legacy ignore events still fire `issue.archived` workflows.
function normalizeIssueAction(parsedJson: unknown): unknown {
  if (typeof parsedJson !== 'object' || parsedJson === null) return parsedJson;
  const obj = parsedJson as {action?: unknown};
  if (obj.action === 'ignored') {
    return {...obj, action: 'archived'};
  }
  return parsedJson;
}

function recordOnly(options: CreateSentryWebhookRoutesOptions, deliveryId: string): Promise<void> {
  return options.coreDb().transaction(async (tx) => {
    await options.recordDeliveryOnly({tx, provider: SENTRY_PROVIDER, deliveryId});
  });
}
