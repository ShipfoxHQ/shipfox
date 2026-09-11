import type {ClickUpWebhookEnvelopeDto} from '@shipfox/api-integration-clickup-dto';
import type {
  IntegrationConnection,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
  RecordDeliveryOnlyFn,
} from '@shipfox/api-integration-spi';
import type {ClickUpInstallation} from '#db/installations.js';

const CLICKUP_PROVIDER = 'clickup';

export interface HandleClickUpWebhookParams {
  tx: IntegrationTx;
  deliveryId: string;
  receivedAt: string;
  rawPayload: ClickUpWebhookEnvelopeDto;
  connection: IntegrationConnection<'clickup'>;
  installation: ClickUpInstallation;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
  recordDeliveryOnly: RecordDeliveryOnlyFn;
}

export type HandleClickUpWebhookResult = 'published' | 'duplicate' | 'discarded';

const actorBearingEvents = new Set<ClickUpWebhookEnvelopeDto['event']>([
  'taskCreated',
  'taskUpdated',
  'taskMoved',
  'taskStatusUpdated',
  'taskAssigneeUpdated',
  'taskPriorityUpdated',
  'taskDueDateUpdated',
  'taskTagUpdated',
  'taskCommentPosted',
  'taskCommentUpdated',
]);

export async function handleClickUpWebhook(
  params: HandleClickUpWebhookParams,
): Promise<HandleClickUpWebhookResult> {
  if (isSelfAuthoredEvent(params.rawPayload, params.installation.authorizingUserId)) {
    await params.recordDeliveryOnly({
      tx: params.tx,
      provider: CLICKUP_PROVIDER,
      deliveryId: params.deliveryId,
    });
    return 'discarded';
  }

  const payload = {...params.rawPayload, team_id: params.installation.teamId};
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: CLICKUP_PROVIDER,
      source: params.connection.slug,
      event: params.rawPayload.event,
      workspaceId: params.connection.workspaceId,
      connectionId: params.connection.id,
      connectionName: params.connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: params.receivedAt,
      payload,
    },
  });
  return result.published ? 'published' : 'duplicate';
}

function isSelfAuthoredEvent(
  payload: ClickUpWebhookEnvelopeDto,
  authorizingUserId: string,
): boolean {
  if (payload.event === 'taskDeleted' || !actorBearingEvents.has(payload.event)) return false;
  return payload.history_items.some(
    (historyItem) => String(historyItem.user.id) === authorizingUserId,
  );
}
