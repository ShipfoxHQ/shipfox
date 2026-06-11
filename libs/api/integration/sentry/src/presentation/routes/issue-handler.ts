import {sentryIssueWebhookSchema} from '@shipfox/api-integration-sentry-dto';
import {logger} from '@shipfox/node-opentelemetry';
import type {FastifyReply} from 'fastify';
import {SentryIssueDroppedError} from '#core/errors.js';
import {handleSentryIssueEvent, normalizeSentryIssueAction} from '#core/webhook.js';
import type {SentryWebhookContext} from './webhook-context.js';
import {parseAndValidateOrDrop, recordAndDrop} from './webhook-delivery.js';

// Validates an issue delivery, then publishes the mapped event in a transaction.
// A malformed or unknown-action payload is recorded-and-dropped (204) before we
// reach core. Core throws a SentryIssueDroppedError when the delivery references
// state we cannot publish against (unknown/deleted installation, missing
// connection); we record-and-drop those too. Any other error bubbles up.
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
    if (error instanceof SentryIssueDroppedError) {
      logger().warn({deliveryId, err: error}, `sentry webhook: ${error.message}, dropping`);
      return recordAndDrop({context, reply, deliveryId});
    }
    throw error;
  }

  reply.code(204);
  return null;
}
