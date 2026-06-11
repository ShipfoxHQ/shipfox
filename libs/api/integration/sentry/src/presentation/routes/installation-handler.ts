import {sentryInstallationWebhookSchema} from '@shipfox/api-integration-sentry-dto';
import type {FastifyReply} from 'fastify';
import {handleSentryInstallationLifecycle} from '#core/webhook.js';
import type {SentryWebhookContext} from './webhook-context.js';
import {parseAndValidateOrDrop} from './webhook-delivery.js';

// Validates an installation lifecycle delivery, then applies it in a transaction.
// A `deleted` action disables the connection and marks the installation deleted;
// other actions are recorded only (the connect flow owns row creation).
export async function handleInstallationResource(args: {
  context: SentryWebhookContext;
  reply: FastifyReply;
  deliveryId: string;
  rawBody: string;
}): Promise<null> {
  const {context, reply, deliveryId, rawBody} = args;

  const payload = await parseAndValidateOrDrop({
    schema: sentryInstallationWebhookSchema,
    rawBody,
    deliveryId,
    context,
    reply,
  });
  if (!payload) return null;

  await context.coreDb().transaction(async (tx) => {
    await handleSentryInstallationLifecycle({
      tx,
      deliveryId,
      action: payload.action,
      installationUuid: payload.installation.uuid,
      recordDeliveryOnly: context.recordDeliveryOnly,
      updateConnectionLifecycleStatus: context.updateConnectionLifecycleStatus,
    });
  });

  reply.code(204);
  return null;
}
