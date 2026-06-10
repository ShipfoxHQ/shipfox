import {sentryIssueWebhookSchema} from '@shipfox/api-integration-sentry-dto';
import type {FastifyReply} from 'fastify';
import {handleSentryIssueEvent, normalizeSentryIssueAction} from '#core/webhook.js';
import type {SentryWebhookContext} from './webhook-context.js';
import {parseAndValidateOrDrop} from './webhook-delivery.js';

// Validates an issue delivery, then publishes the mapped event in a transaction.
// Unknown installations/connections and dedup are handled inside the core event
// handler; a malformed or unknown-action payload is recorded-and-dropped (204).
export async function handleIssueResource(args: {
  context: SentryWebhookContext;
  reply: FastifyReply;
  deliveryId: string;
  rawBody: string;
}): Promise<null> {
  const {context, reply, deliveryId, rawBody} = args;

  const payload = await parseAndValidateOrDrop({
    schema: sentryIssueWebhookSchema,
    normalize: normalizeSentryIssueAction,
    rawBody,
    deliveryId,
    context,
    reply,
  });
  if (!payload) return null;

  await context.coreDb().transaction(async (tx) => {
    await handleSentryIssueEvent({
      tx,
      deliveryId,
      payload,
      publishIntegrationEventReceived: context.publishIntegrationEventReceived,
      recordDeliveryOnly: context.recordDeliveryOnly,
      getIntegrationConnectionById: context.getIntegrationConnectionById,
    });
  });

  reply.code(204);
  return null;
}
