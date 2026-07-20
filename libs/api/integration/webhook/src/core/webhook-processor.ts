import {Buffer} from 'node:buffer';
import {
  decodeWebhookBody,
  type GetIntegrationConnectionByIdFn,
  type IntegrationConnection,
  type IntegrationTx,
  type PublishIntegrationEventReceivedFn,
  type StoredWebhookRequest,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-core-dto';
import {WEBHOOK_PROVIDER, WEBHOOK_RECEIVED_EVENT} from '@shipfox/api-integration-webhook-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {redactHeaders, WEBHOOK_ACCEPTED_CONTENT_TYPES} from '#constants.js';

const [JSON_CONTENT_TYPE, FORM_CONTENT_TYPE, TEXT_CONTENT_TYPE] = WEBHOOK_ACCEPTED_CONTENT_TYPES;

export interface CreateGenericWebhookProcessorOptions {
  coreDb: () => {
    transaction<T>(callback: (tx: IntegrationTx) => Promise<T>): Promise<T>;
  };
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
}

export interface GenericWebhookProcessor {
  process(
    request: StoredWebhookRequest,
    connection?: IntegrationConnection | undefined,
  ): Promise<WebhookProcessingResult>;
}

export function createGenericWebhookProcessor(
  options: CreateGenericWebhookProcessorOptions,
): GenericWebhookProcessor {
  return {
    process: (request, connection) => processWebhookRequest(options, request, connection),
  };
}

async function processWebhookRequest(
  options: CreateGenericWebhookProcessorOptions,
  request: StoredWebhookRequest,
  knownConnection?: IntegrationConnection | undefined,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'webhook.connection') {
    throw new Error(`Generic webhook processor cannot process ${request.route_id} requests`);
  }

  const connection =
    knownConnection ??
    (await options.getIntegrationConnectionById(request.path_parameters.connection_id));
  if (
    !connection ||
    connection.provider !== WEBHOOK_PROVIDER ||
    connection.lifecycleStatus !== 'active'
  ) {
    return {outcome: 'discarded', reason: 'connection_unavailable'};
  }

  const deliveryId = request.headers['x-delivery-id'] ?? request.request_id;
  const body = parseWebhookBody(request);
  if (!body.success) {
    logger().warn({deliveryId, err: body.error}, 'generic webhook payload parsing failed');
    return {outcome: 'discarded', reason: 'malformed_payload', deliveryId};
  }

  await options.coreDb().transaction(async (tx) => {
    await options.publishIntegrationEventReceived({
      tx,
      event: {
        provider: WEBHOOK_PROVIDER,
        source: connection.slug,
        event: WEBHOOK_RECEIVED_EVENT,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        connectionName: connection.displayName,
        deliveryId,
        receivedAt: request.received_at,
        payload: {
          method: request.method,
          headers: redactHeaders(request.headers),
          query: parseWebhookQuery(request.raw_query_string),
          body: body.value,
        },
      },
    });
  });

  return {outcome: 'processed', deliveryId};
}

function parseWebhookQuery(rawQueryString: string): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [name, value] of new URLSearchParams(rawQueryString)) {
    const existingValue = query[name];
    if (existingValue === undefined) {
      query[name] = value;
    } else if (Array.isArray(existingValue)) {
      existingValue.push(value);
    } else {
      query[name] = [existingValue, value];
    }
  }

  return query;
}

function parseWebhookBody(
  request: StoredWebhookRequest,
): {success: true; value: unknown} | {success: false; error?: unknown} {
  const body = Buffer.from(decodeWebhookBody(request.body));
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();

  if (contentType === JSON_CONTENT_TYPE) {
    try {
      return {success: true, value: JSON.parse(body.toString('utf8'))};
    } catch (error) {
      return {success: false, error};
    }
  }
  if (contentType === FORM_CONTENT_TYPE) {
    return {success: true, value: Object.fromEntries(new URLSearchParams(body.toString('utf8')))};
  }
  if (contentType === TEXT_CONTENT_TYPE) return {success: true, value: body.toString('utf8')};

  return {success: false};
}
