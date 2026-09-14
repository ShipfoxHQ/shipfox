import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {
  CLICKUP_PROVIDER,
  type ClickUpWebhookBaseEnvelopeDto,
  clickupWebhookBaseEnvelopeSchema,
  clickupWebhookEnvelopeSchema,
} from '@shipfox/api-integration-clickup-dto';
import {
  decodeWebhookBody,
  type GetIntegrationConnectionByIdFn,
  type IntegrationConnection,
  type PublishIntegrationEventReceivedFn,
  type RecordDeliveryOnlyFn,
  type StoredWebhookRequest,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {verifyHexHmacSignature} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {type ClickUpInstallation, getClickUpInstallationByConnectionId} from '#db/installations.js';
import {recordClickUpWebhookDelivery} from '#metrics/instance.js';
import {handleClickUpWebhook} from './webhook.js';

export interface CreateClickUpWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  getClickUpInstallationByConnectionId?: typeof getClickUpInstallationByConnectionId;
  getWebhookSecret: (connectionId: string) => Promise<string | null>;
}

export interface ClickUpWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

export function createClickUpWebhookProcessor(
  options: CreateClickUpWebhookProcessorOptions,
): ClickUpWebhookProcessor {
  return {process: (request) => processClickUpWebhookRequest(options, request)};
}

async function processClickUpWebhookRequest(
  options: CreateClickUpWebhookProcessorOptions,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'clickup') {
    throw new Error(`ClickUp processor cannot process ${request.route_id} requests`);
  }

  const rawBody = Buffer.from(decodeWebhookBody(request.body));
  const connectionId = request.path_parameters.connection_id;
  const context = await resolveClickUpWebhookContext(options, connectionId);
  if (!context) {
    recordClickUpWebhookDelivery('connection_unavailable');
    return {outcome: 'discarded', reason: 'connection_unavailable'};
  }

  const signature = request.headers['x-signature'];
  const secret = await options.getWebhookSecret(connectionId);
  const signatureIsValid =
    signature !== undefined &&
    secret !== null &&
    verifyHexHmacSignature({rawBody, signature, secret});
  if (!signatureIsValid) {
    recordClickUpWebhookDelivery('invalid_signature');
    return {outcome: 'discarded', reason: 'invalid_signature'};
  }

  const parsedJson = parseClickUpJson(rawBody);
  if (!parsedJson.success) {
    recordClickUpWebhookDelivery('malformed_payload');
    return {outcome: 'discarded', reason: 'malformed_payload'};
  }

  if (context.connection.lifecycleStatus !== 'active') {
    const basePayload = clickupWebhookBaseEnvelopeSchema.safeParse(parsedJson.data);
    const deliveryId = basePayload.success
      ? clickupDeliveryId(connectionId, rawBody, basePayload.data)
      : fallbackDeliveryId(connectionId, rawBody);
    await recordSignedDeliveryOnly(options, deliveryId);
    recordClickUpWebhookDelivery('discarded');
    return {outcome: 'discarded', reason: 'connection_unavailable', deliveryId};
  }

  return await processVerifiedClickUpPayload(options, request, rawBody, context, parsedJson.data);
}

type ClickUpWebhookContext = {
  connection: IntegrationConnection<'clickup'>;
  installation: ClickUpInstallation;
};

async function resolveClickUpWebhookContext(
  options: CreateClickUpWebhookProcessorOptions,
  connectionId: string,
): Promise<ClickUpWebhookContext | undefined> {
  const connection = await options.getIntegrationConnectionById(connectionId);
  if (!connection || connection.provider !== CLICKUP_PROVIDER) return undefined;

  const installation = await (
    options.getClickUpInstallationByConnectionId ?? getClickUpInstallationByConnectionId
  )(connectionId);
  if (!installation || installation.status === 'revoked') return undefined;
  return {connection: connection as IntegrationConnection<'clickup'>, installation};
}

function parseClickUpJson(rawBody: Uint8Array): {success: true; data: unknown} | {success: false} {
  try {
    return {success: true, data: JSON.parse(Buffer.from(rawBody).toString('utf8'))};
  } catch (error) {
    logger().warn({err: error}, 'ClickUp webhook payload JSON parse failed');
    return {success: false};
  }
}

async function processVerifiedClickUpPayload(
  options: CreateClickUpWebhookProcessorOptions,
  request: StoredWebhookRequest,
  rawBody: Uint8Array,
  context: ClickUpWebhookContext,
  rawPayload: unknown,
): Promise<WebhookProcessingResult> {
  const basePayload = clickupWebhookBaseEnvelopeSchema.safeParse(rawPayload);
  const deliveryId = basePayload.success
    ? clickupDeliveryId(request.path_parameters.connection_id, rawBody, basePayload.data)
    : fallbackDeliveryId(request.path_parameters.connection_id, rawBody);

  if (!basePayload.success) {
    logger().warn(
      {deliveryId, issues: basePayload.error.issues},
      'ClickUp webhook envelope failed base schema validation',
    );
    await recordSignedDeliveryOnly(options, deliveryId);
    recordClickUpWebhookDelivery('discarded');
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }

  if (context.installation.webhookId !== basePayload.data.webhook_id) {
    await recordSignedDeliveryOnly(options, deliveryId);
    recordClickUpWebhookDelivery('discarded');
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }

  const payload = clickupWebhookEnvelopeSchema.safeParse(rawPayload);
  if (!payload.success) {
    logger().warn(
      {deliveryId, issues: payload.error.issues},
      'ClickUp webhook envelope failed schema validation',
    );
    await recordSignedDeliveryOnly(options, deliveryId);
    recordClickUpWebhookDelivery('discarded');
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }

  const result = await options.coreDb().transaction(async (tx) =>
    handleClickUpWebhook({
      tx,
      deliveryId,
      receivedAt: request.received_at,
      rawPayload: payload.data,
      connection: context.connection,
      installation: context.installation,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      recordDeliveryOnly: options.recordDeliveryOnly,
    }),
  );

  if (result === 'duplicate') {
    recordClickUpWebhookDelivery('duplicate');
    return {outcome: 'duplicate', deliveryId};
  }
  if (result === 'discarded') {
    recordClickUpWebhookDelivery('discarded');
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }
  recordClickUpWebhookDelivery('processed');
  return {outcome: 'processed', deliveryId};
}

function clickupDeliveryId(
  connectionId: string,
  rawBody: Uint8Array,
  payload: ClickUpWebhookBaseEnvelopeDto,
): string {
  const firstHistoryItem = payload.history_items?.[0];
  if (firstHistoryItem) {
    return `${payload.webhook_id}:${payload.event}:${firstHistoryItem.id}`;
  }
  return fallbackDeliveryId(connectionId, rawBody);
}

function fallbackDeliveryId(connectionId: string, rawBody: Uint8Array): string {
  return createHash('sha256').update(connectionId).update('\0').update(rawBody).digest('hex');
}

async function recordSignedDeliveryOnly(
  options: Pick<CreateClickUpWebhookProcessorOptions, 'coreDb' | 'recordDeliveryOnly'>,
  deliveryId: string,
): Promise<void> {
  await options.coreDb().transaction(async (tx) => {
    await options.recordDeliveryOnly({tx, provider: CLICKUP_PROVIDER, deliveryId});
  });
}
