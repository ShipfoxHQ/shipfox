import type {ClickUpWebhookEnvelopeDto} from '@shipfox/api-integration-clickup-dto';
import type {
  IntegrationConnection,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
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
}

export type HandleClickUpWebhookResult = 'published' | 'duplicate';

export async function handleClickUpWebhook(
  params: HandleClickUpWebhookParams,
): Promise<HandleClickUpWebhookResult> {
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
