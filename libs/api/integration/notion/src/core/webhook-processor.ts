import {Buffer} from 'node:buffer';
import {
  NOTION_PROVIDER,
  notionWebhookBaseEnvelopeSchema,
  notionWebhookEnvelopeSchema,
  notionWebhookHandshakeSchema,
} from '@shipfox/api-integration-notion-dto';
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
import {config} from '#config.js';
import {getNotionInstallationByWorkspaceId} from '#db/installations.js';
import {recordNotionWebhookDelivery} from '#metrics/instance.js';
import {handleNotionWebhook} from './webhook.js';

const SIGNATURE_HEADER = 'x-notion-signature';
const SIGNATURE_PREFIX = 'sha256=';

export interface CreateNotionWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  getNotionInstallationByWorkspaceId?: typeof getNotionInstallationByWorkspaceId;
  /** Test seam for exercising both sides of the deployment handshake. */
  verificationToken?: string | null | undefined;
}

export interface NotionWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

interface NotionWebhookProcessorState {
  verificationTokenLogged: boolean;
}

export function createNotionWebhookProcessor(
  options: CreateNotionWebhookProcessorOptions,
): NotionWebhookProcessor {
  const state: NotionWebhookProcessorState = {verificationTokenLogged: false};
  return {process: (request) => processNotionWebhookRequest(options, state, request)};
}

async function processNotionWebhookRequest(
  options: CreateNotionWebhookProcessorOptions,
  state: NotionWebhookProcessorState,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'notion') {
    throw new Error(`Notion processor cannot process ${request.route_id} requests`);
  }

  const rawBody = Buffer.from(decodeWebhookBody(request.body));
  const parsed = parseJson(rawBody);
  const verificationToken =
    options.verificationToken === undefined
      ? config.NOTION_WEBHOOK_VERIFICATION_TOKEN
      : (options.verificationToken ?? undefined);

  if (parsed.success && notionWebhookHandshakeSchema.safeParse(parsed.data).success) {
    logVerificationTokenOnce({state, verificationToken, payload: parsed.data});
    recordNotionWebhookDelivery('handshake');
    return {outcome: 'processed'};
  }

  const signature = request.headers[SIGNATURE_HEADER];
  if (
    typeof signature !== 'string' ||
    !verificationToken ||
    !verifyHexHmacSignature({
      rawBody,
      signature: stripSignaturePrefix(signature),
      secret: verificationToken,
    })
  ) {
    recordNotionWebhookDelivery('invalid_signature');
    return {outcome: 'discarded', reason: 'invalid_signature'};
  }

  if (!parsed.success) {
    recordNotionWebhookDelivery('malformed_payload');
    return {outcome: 'discarded', reason: 'malformed_payload'};
  }

  const basePayload = notionWebhookBaseEnvelopeSchema.safeParse(parsed.data);
  if (!basePayload.success) {
    logger().warn(
      {issues: basePayload.error.issues},
      'Notion webhook envelope failed base schema validation',
    );
    recordNotionWebhookDelivery('malformed_payload');
    return {outcome: 'discarded', reason: 'malformed_payload'};
  }

  const deliveryId = basePayload.data.id;
  const payload = notionWebhookEnvelopeSchema.safeParse(parsed.data);
  if (!payload.success) {
    await recordDeliveryOnlyInTransaction(options, deliveryId);
    recordNotionWebhookDelivery('unsupported_event');
    return {outcome: 'discarded', reason: 'unsupported_event', deliveryId};
  }

  const result = await options.coreDb().transaction(async (tx) => {
    const installation = await (
      options.getNotionInstallationByWorkspaceId ?? getNotionInstallationByWorkspaceId
    )(payload.data.workspace_id, {tx});
    if (installation?.status !== 'installed') {
      if (installation) {
        await recordDeliveryOnly({
          options,
          tx,
          deliveryId,
          connectionId: installation.connectionId,
        });
      }
      return {outcome: 'connection-unavailable' as const};
    }

    const connection = await options.getIntegrationConnectionById(installation.connectionId, {tx});
    if (!connection || connection.provider !== NOTION_PROVIDER) {
      await recordDeliveryOnly({
        options,
        tx,
        deliveryId,
        connectionId: installation.connectionId,
      });
      return {outcome: 'connection-unavailable' as const};
    }

    if (connection.lifecycleStatus !== 'active') {
      await recordDeliveryOnly({
        options,
        tx,
        deliveryId,
        connectionId: installation.connectionId,
      });
      return {outcome: 'connection-unavailable' as const};
    }

    const isVisible =
      installation.botId.length > 0 &&
      payload.data.accessible_by?.some((actor) => actor.id === installation.botId) === true;
    if (!isVisible) {
      await recordDeliveryOnly({
        options,
        tx,
        deliveryId,
        connectionId: installation.connectionId,
      });
      return {outcome: 'grant-visibility-discarded' as const};
    }

    const handled = await handleNotionWebhook({
      tx,
      deliveryId,
      receivedAt: request.received_at,
      payload: payload.data,
      rawPayload: parsed.data,
      connection: connection as IntegrationConnection<'notion'>,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
    });
    return {outcome: handled};
  });

  if (result.outcome === 'published') {
    recordNotionWebhookDelivery('processed');
    return {outcome: 'processed', deliveryId};
  }
  if (result.outcome === 'duplicate') {
    recordNotionWebhookDelivery('duplicate');
    return {outcome: 'duplicate', deliveryId};
  }
  if (result.outcome === 'grant-visibility-discarded') {
    recordNotionWebhookDelivery('grant_visibility_discarded');
    return {outcome: 'discarded', reason: 'connection_unavailable', deliveryId};
  }

  recordNotionWebhookDelivery('connection_unavailable');
  return {outcome: 'discarded', reason: 'connection_unavailable', deliveryId};
}

function logVerificationTokenOnce(params: {
  state: NotionWebhookProcessorState;
  verificationToken: string | undefined;
  payload: unknown;
}): void {
  if (params.verificationToken !== undefined || params.state.verificationTokenLogged) return;

  const handshake = notionWebhookHandshakeSchema.parse(params.payload);
  logger().warn(
    {verificationToken: handshake.verification_token},
    'Notion webhook verification token received; set NOTION_WEBHOOK_VERIFICATION_TOKEN',
  );
  params.state.verificationTokenLogged = true;
}

function parseJson(rawBody: Uint8Array): {success: true; data: unknown} | {success: false} {
  try {
    return {success: true, data: JSON.parse(Buffer.from(rawBody).toString('utf8'))};
  } catch (error) {
    logger().warn({err: error}, 'Notion webhook payload JSON parse failed');
    return {success: false};
  }
}

function stripSignaturePrefix(signature: string): string {
  return signature.startsWith(SIGNATURE_PREFIX)
    ? signature.slice(SIGNATURE_PREFIX.length)
    : signature;
}

async function recordDeliveryOnlyInTransaction(
  options: Pick<CreateNotionWebhookProcessorOptions, 'coreDb' | 'recordDeliveryOnly'>,
  deliveryId: string,
): Promise<void> {
  await options.coreDb().transaction(async (tx) => {
    await recordDeliveryOnly({options, tx, deliveryId});
  });
}

async function recordDeliveryOnly(params: {
  options: Pick<CreateNotionWebhookProcessorOptions, 'recordDeliveryOnly'>;
  tx: unknown;
  deliveryId: string;
  connectionId?: string | undefined;
}): Promise<void> {
  await params.options.recordDeliveryOnly({
    tx: params.tx,
    provider: NOTION_PROVIDER,
    deliveryId: params.deliveryId,
    ...(params.connectionId === undefined ? {} : {connectionId: params.connectionId}),
  });
}
