import {Buffer} from 'node:buffer';
import {
  decodeWebhookBody,
  type GetIntegrationConnectionByIdFn,
  type PublishIntegrationEventReceivedFn,
  type RecordDeliveryOnlyFn,
  type StoredWebhookRequest,
  type UpdateIntegrationConnectionLifecycleStatusFn,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-core-dto';
import {
  sentryInstallationWebhookSchema,
  sentryIssueWebhookSchema,
} from '@shipfox/api-integration-sentry-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import type {SentryApiClient} from '#api/client.js';
import {config} from '#config.js';
import {SentryIssueDroppedError} from '#core/errors.js';
import {
  handleSentryInstallationCreated,
  handleSentryInstallationDeleted,
  handleSentryIssueEvent,
  normalizeSentryIssueAction,
} from '#core/webhook.js';
import {
  completeSentryInstallationVerification,
  getSentryInstallationByInstallationUuid,
} from '#db/installations.js';
import {verifySentrySignature} from './signature.js';

const DELIVERY_ID_HEADER = 'request-id';
const RESOURCE_HEADER = 'sentry-hook-resource';
const SIGNATURE_HEADER = 'sentry-hook-signature';
const LEGACY_SIGNATURE_HEADER = 'sentry-app-signature';
const ISSUE_RESOURCE = 'issue';
const INSTALLATION_RESOURCE = 'installation';
const SENTRY_PROVIDER = 'sentry';

export interface SentryWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

export interface CreateSentryWebhookProcessorOptions {
  sentry: SentryApiClient;
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  updateConnectionLifecycleStatus: UpdateIntegrationConnectionLifecycleStatusFn;
}

export function createSentryWebhookProcessor(
  context: CreateSentryWebhookProcessorOptions,
): SentryWebhookProcessor {
  return {process: (request) => processSentryWebhookRequest(context, request)};
}

async function processSentryWebhookRequest(
  context: CreateSentryWebhookProcessorOptions,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'sentry') {
    throw new Error(`Sentry processor cannot process ${request.route_id} requests`);
  }

  const deliveryId = request.headers[DELIVERY_ID_HEADER];
  const resource = request.headers[RESOURCE_HEADER];
  const signature = request.headers[SIGNATURE_HEADER] ?? request.headers[LEGACY_SIGNATURE_HEADER];
  if (!deliveryId || !resource || !signature) {
    return {outcome: 'discarded', reason: 'missing_required_input'};
  }

  const rawBody = Buffer.from(decodeWebhookBody(request.body));
  if (!verifySentrySignature({rawBody, signature, secret: config.SENTRY_APP_CLIENT_SECRET})) {
    return {outcome: 'discarded', reason: 'invalid_signature', deliveryId};
  }

  logger().debug(
    {
      deliveryId,
      signatureHeader: request.headers[SIGNATURE_HEADER]
        ? SIGNATURE_HEADER
        : LEGACY_SIGNATURE_HEADER,
    },
    'sentry webhook: signature verified',
  );

  if (resource === ISSUE_RESOURCE) return processIssueResource(context, deliveryId, rawBody);
  if (resource === INSTALLATION_RESOURCE)
    return processInstallationResource(context, deliveryId, rawBody);

  await recordDeliveryOnly(context, deliveryId);
  return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
}

async function processIssueResource(
  context: CreateSentryWebhookProcessorOptions,
  deliveryId: string,
  rawBody: Uint8Array,
): Promise<WebhookProcessingResult> {
  const parsed = parsePayload(
    sentryIssueWebhookSchema,
    rawBody,
    deliveryId,
    normalizeSentryIssueAction,
  );
  if (!parsed.success) {
    await recordDeliveryOnly(context, deliveryId);
    return {outcome: 'discarded', reason: parsed.reason, deliveryId};
  }
  const payload = parsed.data;

  try {
    await context.coreDb().transaction(async (tx) => {
      await handleSentryIssueEvent({
        tx,
        deliveryId,
        payload,
        publishIntegrationEventReceived: context.publishIntegrationEventReceived,
        getIntegrationConnectionById: context.getIntegrationConnectionById,
      });
    });
  } catch (error) {
    if (!(error instanceof SentryIssueDroppedError)) throw error;

    logger().warn({deliveryId, err: error}, `sentry webhook: ${error.message}, dropping`);
    await recordDeliveryOnly(context, deliveryId);
    return {outcome: 'discarded', reason: 'connection_unavailable', deliveryId};
  }

  return {outcome: 'processed', deliveryId};
}

async function processInstallationResource(
  context: CreateSentryWebhookProcessorOptions,
  deliveryId: string,
  rawBody: Uint8Array,
): Promise<WebhookProcessingResult> {
  const parsed = parsePayload(sentryInstallationWebhookSchema, rawBody, deliveryId);
  if (!parsed.success) {
    await recordDeliveryOnly(context, deliveryId);
    return {outcome: 'discarded', reason: parsed.reason, deliveryId};
  }
  const payload = parsed.data;

  const installation = payload.data.installation;
  if (payload.action === 'deleted') {
    await context.coreDb().transaction(async (tx) => {
      await handleSentryInstallationDeleted({
        tx,
        deliveryId,
        installationUuid: installation.uuid,
        recordDeliveryOnly: context.recordDeliveryOnly,
        updateConnectionLifecycleStatus: context.updateConnectionLifecycleStatus,
      });
    });
    return {outcome: 'processed', deliveryId};
  }

  await handleSentryInstallationCreated({
    deliveryId,
    installationUuid: installation.uuid,
    orgSlug: installation.organization?.slug,
    code: installation.code,
    sentry: context.sentry,
    verifyInstall: config.SENTRY_APP_VERIFY_INSTALL,
    getSentryInstallation: ({installationUuid}) =>
      getSentryInstallationByInstallationUuid(installationUuid),
    persistUnclaimedAndRecordDelivery: ({installationUuid, codeHash, deliveryId: id}) =>
      context.coreDb().transaction(async (tx) => {
        const completed = await completeSentryInstallationVerification(
          {installationUuid, codeHash},
          {tx},
        );
        await context.recordDeliveryOnly({tx, provider: SENTRY_PROVIDER, deliveryId: id});
        if (completed) return completed;

        const current = await getSentryInstallationByInstallationUuid(installationUuid, {tx});
        if (!current) throw new Error('Sentry installation verification lost its claim');
        return current;
      }),
    recordDelivery: (id) => recordDeliveryOnly(context, id),
  });

  return {outcome: 'processed', deliveryId};
}

type ParsePayloadResult<T> =
  | {success: true; data: T}
  | {success: false; reason: 'malformed_payload' | 'unsupported_event'};

function parsePayload<T>(
  schema: {safeParse(value: unknown): {success: true; data: T} | {success: false; error: unknown}},
  rawBody: Uint8Array,
  deliveryId: string,
  normalize: (payload: unknown) => unknown = (payload) => payload,
): ParsePayloadResult<T> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch (error) {
    logger().warn({deliveryId, err: error}, 'sentry webhook: payload JSON parse failed, dropping');
    return {success: false, reason: 'malformed_payload'};
  }

  const payload = schema.safeParse(normalize(parsedJson));
  if (payload.success) return {success: true, data: payload.data};

  logger().warn(
    {deliveryId, issues: payload.error},
    'sentry webhook: payload failed validation, dropping',
  );
  return {success: false, reason: 'unsupported_event'};
}

async function recordDeliveryOnly(
  context: CreateSentryWebhookProcessorOptions,
  deliveryId: string,
): Promise<void> {
  await context.coreDb().transaction(async (tx) => {
    await context.recordDeliveryOnly({tx, provider: SENTRY_PROVIDER, deliveryId});
  });
}
