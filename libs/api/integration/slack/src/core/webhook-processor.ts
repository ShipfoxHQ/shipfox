import {Buffer} from 'node:buffer';
import type {
  ClaimWebhookDeliveryFn,
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  StoredWebhookRequest,
  WebhookProcessingResult,
} from '@shipfox/api-integration-core-dto';
import {decodeWebhookBody} from '@shipfox/api-integration-core-dto';
import {
  slackEventsRequestSchema,
  slackSlashCommandSchema,
} from '@shipfox/api-integration-slack-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {isSlackTimestampWithinReplayWindow, verifySlackSignature} from '#core/signature.js';
import {handleSlackCommand, handleSlackEvent, type SlackWebhookOutcome} from '#core/webhook.js';

const SIGNATURE_HEADER = 'x-slack-signature';
const TIMESTAMP_HEADER = 'x-slack-request-timestamp';

export interface CreateSlackWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  claimWebhookDelivery: ClaimWebhookDeliveryFn;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
}

export type SlackWebhookProcessingResult = WebhookProcessingResult;

export interface SlackWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
}

export function createSlackWebhookProcessor(
  options: CreateSlackWebhookProcessorOptions,
): SlackWebhookProcessor {
  return {process: (request) => processSlackWebhookRequest(options, request)};
}

function processSlackWebhookRequest(
  options: CreateSlackWebhookProcessorOptions,
  request: StoredWebhookRequest,
): Promise<WebhookProcessingResult> {
  if (request.route_id !== 'slack.event' && request.route_id !== 'slack.command') {
    throw new Error(`Slack processor cannot process ${request.route_id} requests`);
  }

  const signature = request.headers[SIGNATURE_HEADER];
  const timestamp = request.headers[TIMESTAMP_HEADER];
  if (!signature || !timestamp) {
    return Promise.resolve({outcome: 'discarded', reason: 'missing_required_input'});
  }

  const rawBody = decodeWebhookBody(request.body);
  const receiptTime = new Date(request.received_at).getTime();
  if (!isSlackTimestampWithinReplayWindow(timestamp, receiptTime)) {
    return Promise.resolve({outcome: 'discarded', reason: 'stale_at_receipt'});
  }
  if (
    !verifySlackSignature({
      signingSecret: config.SLACK_SIGNING_SECRET,
      signature,
      timestamp,
      rawBody,
      now: receiptTime,
    })
  ) {
    return Promise.resolve({outcome: 'discarded', reason: 'invalid_signature'});
  }

  return request.route_id === 'slack.event'
    ? processSlackEvent(options, rawBody)
    : processSlackCommand(options, rawBody);
}

async function processSlackEvent(
  options: CreateSlackWebhookProcessorOptions,
  rawBody: Uint8Array,
): Promise<WebhookProcessingResult> {
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch (error) {
    logger().warn({err: error}, 'slack events payload JSON parse failed');
    return {outcome: 'discarded', reason: 'malformed_payload'};
  }

  const event = slackEventsRequestSchema.safeParse(rawPayload);
  if (!event.success) {
    logger().warn({issues: event.error.issues}, 'slack events envelope failed schema validation');
    return {outcome: 'discarded', reason: 'unsupported_event'};
  }
  const envelope = event.data;
  if (envelope.type === 'url_verification') {
    return {outcome: 'processed', challenge: envelope.challenge};
  }

  const result = await options.coreDb().transaction(async (tx) =>
    handleSlackEvent({
      tx,
      deliveryId: envelope.event_id,
      envelope,
      claimWebhookDelivery: options.claimWebhookDelivery,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      recordDeliveryOnly: options.recordDeliveryOnly,
      getIntegrationConnectionById: options.getIntegrationConnectionById,
    }),
  );
  return toProcessingResult(result.outcome, envelope.event_id);
}

async function processSlackCommand(
  options: CreateSlackWebhookProcessorOptions,
  rawBody: Uint8Array,
): Promise<WebhookProcessingResult> {
  const command = slackSlashCommandSchema.safeParse(
    Object.fromEntries(new URLSearchParams(Buffer.from(rawBody).toString('utf8'))),
  );
  if (!command.success) {
    logger().warn({issues: command.error.issues}, 'slack command failed schema validation');
    return {outcome: 'discarded', reason: 'unsupported_event'};
  }

  const result = await options.coreDb().transaction(async (tx) =>
    handleSlackCommand({
      tx,
      deliveryId: command.data.trigger_id,
      command: command.data,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      recordDeliveryOnly: options.recordDeliveryOnly,
      getIntegrationConnectionById: options.getIntegrationConnectionById,
    }),
  );
  return toProcessingResult(result.outcome, command.data.trigger_id);
}

function toProcessingResult(
  outcome: SlackWebhookOutcome,
  deliveryId: string,
): WebhookProcessingResult {
  if (outcome === 'published') return {outcome: 'processed', deliveryId};
  if (outcome === 'duplicate') return {outcome: 'duplicate', deliveryId};
  return {
    outcome: 'discarded',
    reason: outcome === 'unsupported-event' ? 'unsupported_event' : 'connection_unavailable',
    deliveryId,
  };
}
