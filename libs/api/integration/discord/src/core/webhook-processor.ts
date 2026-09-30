import {Buffer} from 'node:buffer';
import {discordInteractionEnvelopeSchema} from '@shipfox/api-integration-discord-dto';
import type {
  GetIntegrationConnectionByIdFn,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
  StoredWebhookRequest,
  WebhookProcessingResult,
} from '@shipfox/api-integration-spi';
import {decodeWebhookBody} from '@shipfox/api-integration-spi';
import {logger} from '@shipfox/node-opentelemetry';
import type {NodePgDatabase} from 'drizzle-orm/node-postgres';
import {config} from '#config.js';
import {
  classifyDiscordCommand,
  DISCORD_ACK_UNSUPPORTED,
  DISCORD_PONG,
  type DiscordInteractionResponse,
  discordEphemeralMessage,
  handleDiscordCommand,
} from '#core/interactions.js';
import {isDiscordTimestampFresh, verifyDiscordSignature} from '#core/signature.js';

export const DISCORD_SIGNATURE_HEADER = 'x-signature-ed25519';
export const DISCORD_TIMESTAMP_HEADER = 'x-signature-timestamp';

export interface CreateDiscordWebhookProcessorOptions {
  coreDb: () => NodePgDatabase<Record<string, unknown>>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
  getIntegrationConnectionById: GetIntegrationConnectionByIdFn;
  /** Hex-encoded Ed25519 public key. Defaults to `DISCORD_PUBLIC_KEY`. */
  publicKey?: string | undefined;
}

export interface DiscordInteractionProcessingResult {
  result: WebhookProcessingResult;
  /** The synchronous answer Discord expects. Absent when the request was rejected. */
  response?: DiscordInteractionResponse | undefined;
}

export interface DiscordWebhookProcessor {
  process(request: StoredWebhookRequest): Promise<WebhookProcessingResult>;
  processInteraction(request: StoredWebhookRequest): Promise<DiscordInteractionProcessingResult>;
}

export function createDiscordWebhookProcessor(
  options: CreateDiscordWebhookProcessorOptions,
): DiscordWebhookProcessor {
  const processInteraction = (request: StoredWebhookRequest) =>
    processDiscordInteraction(options, request);
  return {
    process: async (request) => (await processInteraction(request)).result,
    processInteraction,
  };
}

async function processDiscordInteraction(
  options: CreateDiscordWebhookProcessorOptions,
  request: StoredWebhookRequest,
): Promise<DiscordInteractionProcessingResult> {
  if (request.route_id !== 'discord.interaction') {
    throw new Error(`Discord processor cannot process ${request.route_id} requests`);
  }

  const signature = request.headers[DISCORD_SIGNATURE_HEADER];
  const timestamp = request.headers[DISCORD_TIMESTAMP_HEADER];
  if (!signature || !timestamp) {
    return {result: {outcome: 'discarded', reason: 'missing_required_input'}};
  }

  const rawBody = decodeWebhookBody(request.body);
  if (
    !verifyDiscordSignature({
      publicKey: options.publicKey ?? config.DISCORD_PUBLIC_KEY,
      signature,
      timestamp,
      rawBody,
    })
  ) {
    return {result: {outcome: 'discarded', reason: 'invalid_signature'}};
  }

  // The signature stays valid forever, so this bound is what stops a captured request from being
  // replayed once its delivery record has been pruned.
  if (!isDiscordTimestampFresh(timestamp, new Date(request.received_at).getTime())) {
    return {result: {outcome: 'discarded', reason: 'stale_at_receipt'}};
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(Buffer.from(rawBody).toString('utf8'));
  } catch (error) {
    logger().warn({err: error}, 'discord interaction JSON parse failed');
    return {result: {outcome: 'discarded', reason: 'malformed_payload'}};
  }
  const parsed = discordInteractionEnvelopeSchema.safeParse(rawPayload);
  if (!parsed.success) {
    logger().warn({issues: parsed.error.issues}, 'discord interaction failed schema validation');
    return {result: {outcome: 'discarded', reason: 'malformed_payload'}};
  }
  const interaction = parsed.data;

  if (interaction.type === 1) {
    return {result: {outcome: 'processed'}, response: DISCORD_PONG};
  }

  const command = classifyDiscordCommand(interaction);
  if (!command) {
    return {
      result: {outcome: 'discarded', reason: 'unsupported_event', deliveryId: interaction.id},
      response: discordEphemeralMessage(DISCORD_ACK_UNSUPPORTED),
    };
  }

  const {outcome, response} = await options.coreDb().transaction((tx) =>
    handleDiscordCommand({
      tx,
      interaction,
      command,
      publishIntegrationEventReceived: options.publishIntegrationEventReceived,
      recordDeliveryOnly: options.recordDeliveryOnly,
      getIntegrationConnectionById: options.getIntegrationConnectionById,
    }),
  );
  const deliveryId = interaction.id;
  if (outcome === 'published') return {result: {outcome: 'processed', deliveryId}, response};
  if (outcome === 'duplicate') return {result: {outcome: 'duplicate', deliveryId}, response};
  return {
    result: {
      outcome: 'discarded',
      reason: outcome === 'unsupported-command' ? 'unsupported_event' : 'connection_unavailable',
      deliveryId,
    },
    response,
  };
}
