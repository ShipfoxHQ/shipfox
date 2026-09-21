import {
  NOTION_PROVIDER,
  type NotionWebhookBaseEnvelopeDto,
} from '@shipfox/api-integration-notion-dto';
import type {
  IntegrationConnection,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
} from '@shipfox/api-integration-spi';

export interface HandleNotionWebhookParams {
  tx: IntegrationTx;
  deliveryId: string;
  receivedAt: string;
  payload: NotionWebhookBaseEnvelopeDto;
  rawPayload: unknown;
  connection: IntegrationConnection<'notion'>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
}

export type HandleNotionWebhookResult = 'published' | 'duplicate';

export async function handleNotionWebhook(
  params: HandleNotionWebhookParams,
): Promise<HandleNotionWebhookResult> {
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: NOTION_PROVIDER,
      source: params.connection.slug,
      event: params.payload.type,
      workspaceId: params.connection.workspaceId,
      connectionId: params.connection.id,
      connectionName: params.connection.displayName,
      deliveryId: params.deliveryId,
      receivedAt: params.receivedAt,
      payload: params.rawPayload,
    },
  });

  return result.published ? 'published' : 'duplicate';
}
