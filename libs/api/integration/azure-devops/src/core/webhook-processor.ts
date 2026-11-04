import {Buffer} from 'node:buffer';
import {timingSafeEqual} from 'node:crypto';
import {azureDevOpsServiceHookEnvelopeSchema} from '@shipfox/api-integration-azure-devops-dto';
import {
  decodeWebhookBody,
  type GetIntegrationConnectionByIdFn,
  type PublishIntegrationEventReceivedFn,
  type PublishSourcePushFn,
  type RecordDeliveryOnlyFn,
  type StoredWebhookRequest,
  type WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {
  type AzureDevOpsConnection,
  getAzureDevOpsConnectionByConnectionId,
} from '#db/connections.js';
import {
  type AzureDevOpsIntegrationConnection,
  type AzureDevOpsSecretsStore,
  azureDevOpsProviderKind,
  azureDevOpsSecretsNamespace,
  WEBHOOK_PASSWORD_KEY,
} from './credentials.js';
import {handleAzureDevOpsWebhook} from './webhook.js';

const BASIC_PREFIX = 'basic ';

export interface CreateAzureDevOpsWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  secrets: AzureDevOpsSecretsStore;
  publishSourcePush: PublishSourcePushFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  getAzureDevOpsConnection?:
    | ((connectionId: string) => Promise<AzureDevOpsConnection | undefined>)
    | undefined;
}

export interface AzureDevOpsWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

export function createAzureDevOpsWebhookProcessor(
  options: CreateAzureDevOpsWebhookProcessorOptions,
): AzureDevOpsWebhookProcessor {
  return {process: (request) => processAzureDevOpsWebhookRequest(options, request)};
}

async function processAzureDevOpsWebhookRequest(
  options: CreateAzureDevOpsWebhookProcessorOptions,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'azure-devops') {
    throw new Error(`Azure DevOps processor cannot process ${request.route_id} requests`);
  }
  const connectionId = request.path_parameters.connection_id;
  const presented = parseBasicAuthorization(request.headers.authorization);
  if (!presented) return {outcome: 'discarded', reason: 'missing_required_input'};

  const connection = await authenticate(options, connectionId, presented);
  if (!connection) return {outcome: 'discarded', reason: 'invalid_signature'};

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(decodeWebhookBody(request.body)).toString('utf8'));
  } catch (error) {
    logger().warn({connectionId, err: error}, 'azure devops webhook payload JSON parse failed');
    return {outcome: 'discarded', reason: 'malformed_payload'};
  }
  const envelope = azureDevOpsServiceHookEnvelopeSchema.safeParse(rawPayload);
  if (!envelope.success) {
    logger().warn(
      {connectionId, issues: envelope.error.issues},
      'azure devops webhook payload is not a Service Hook notification',
    );
    return {outcome: 'discarded', reason: 'malformed_payload'};
  }

  const deliveryId = envelope.data.id;
  const outcome = await options.coreDb().transaction(async (tx) =>
    handleAzureDevOpsWebhook({
      tx,
      connection,
      envelope: envelope.data,
      rawPayload,
      receivedAt: request.received_at,
      publishSourcePush: options.publishSourcePush,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      recordDeliveryOnly: options.recordDeliveryOnly,
    }),
  );
  return outcome === 'duplicate'
    ? {outcome: 'duplicate', deliveryId}
    : {outcome: 'processed', deliveryId};
}

/**
 * Service Hooks do not sign payloads. Each connection gets its own basic-auth user and password
 * for its hook; both must match. Every failure looks the same to the caller, so a probe cannot
 * tell an unknown connection from a wrong password.
 */
async function authenticate(
  options: CreateAzureDevOpsWebhookProcessorOptions,
  connectionId: string,
  presented: {username: string; password: string},
): Promise<AzureDevOpsIntegrationConnection | undefined> {
  const connection = await options.getIntegrationConnectionById(connectionId);
  if (!connection || connection.provider !== azureDevOpsProviderKind) return undefined;
  const row = await (options.getAzureDevOpsConnection ?? getAzureDevOpsConnectionByConnectionId)(
    connectionId,
  );
  if (!row) return undefined;
  const expectedPassword = await options.secrets.getSecret({
    workspaceId: connection.workspaceId,
    namespace: azureDevOpsSecretsNamespace(connectionId),
    key: WEBHOOK_PASSWORD_KEY,
  });
  if (!expectedPassword) return undefined;
  const usernameMatches = constantTimeEquals(presented.username, row.webhookUsername);
  const passwordMatches = constantTimeEquals(presented.password, expectedPassword);
  return usernameMatches && passwordMatches
    ? (connection as AzureDevOpsIntegrationConnection)
    : undefined;
}

function parseBasicAuthorization(
  header: string | undefined,
): {username: string; password: string} | null {
  if (!header?.toLowerCase().startsWith(BASIC_PREFIX)) return null;
  const decoded = Buffer.from(header.slice(BASIC_PREFIX.length).trim(), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator <= 0) return null;
  return {username: decoded.slice(0, separator), password: decoded.slice(separator + 1)};
}

function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}
