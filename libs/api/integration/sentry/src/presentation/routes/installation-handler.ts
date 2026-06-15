import {sentryInstallationWebhookSchema} from '@shipfox/api-integration-sentry-dto';
import type {FastifyReply} from 'fastify';
import {config} from '#config.js';
import {handleSentryInstallationCreated, handleSentryInstallationDeleted} from '#core/webhook.js';
import {
  getSentryInstallationByInstallationUuid,
  persistVerifiedUnclaimedInstallation,
} from '#db/installations.js';
import type {SentryWebhookContext} from './webhook-context.js';
import {parseAndValidateOrDrop} from './webhook-delivery.js';

const SENTRY_PROVIDER = 'sentry';

// Validates an installation lifecycle delivery, then applies it. `created` is the
// authoritative install signal: it exchanges the single-use code and persists a
// verified-unclaimed row (exchange outside any transaction; persist + delivery
// record in one short transaction). `deleted` tombstones the install and disables
// the connection in a single transaction.
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
    reply.code(204);
    return null;
  }

  await handleSentryInstallationCreated({
    deliveryId,
    installationUuid: installation.uuid,
    orgSlug: installation.organization?.slug,
    code: installation.code,
    sentry: context.sentry,
    verifyInstall: config.SENTRY_APP_VERIFY_INSTALL,
    getSentryInstallation: (installationUuid) =>
      getSentryInstallationByInstallationUuid(installationUuid),
    persistUnclaimedAndRecordDelivery: ({installationUuid, orgSlug, codeHash, deliveryId: id}) =>
      context.coreDb().transaction(async (tx) => {
        const persisted = await persistVerifiedUnclaimedInstallation(
          {installationUuid, orgSlug, codeHash},
          {tx},
        );
        await context.recordDeliveryOnly({tx, provider: SENTRY_PROVIDER, deliveryId: id});
        return persisted;
      }),
    recordDelivery: (id) =>
      context.coreDb().transaction(async (tx) => {
        await context.recordDeliveryOnly({tx, provider: SENTRY_PROVIDER, deliveryId: id});
      }),
  });

  reply.code(204);
  return null;
}
