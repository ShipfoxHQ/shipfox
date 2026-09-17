import type {JiraWebhookEnvelopeDto} from '@shipfox/api-integration-jira-dto';
import type {
  IntegrationConnection,
  IntegrationTx,
  PublishIntegrationEventReceivedFn,
} from '@shipfox/api-integration-spi';
import type {JiraInstallation} from '#db/installations.js';

const JIRA_PROVIDER = 'jira';

export interface HandleJiraWebhookParams {
  tx: IntegrationTx;
  deliveryId: string;
  receivedAt: string;
  rawPayload: JiraWebhookEnvelopeDto;
  cloudId: string;
  connection: IntegrationConnection<'jira'>;
  publishIntegrationEventReceived: PublishIntegrationEventReceivedFn;
}

export type HandleJiraWebhookResult = 'published' | 'duplicate';

export async function handleJiraWebhook(
  params: HandleJiraWebhookParams,
): Promise<HandleJiraWebhookResult> {
  const payload = {...params.rawPayload, cloudId: params.cloudId};
  const result = await params.publishIntegrationEventReceived({
    tx: params.tx,
    event: {
      provider: JIRA_PROVIDER,
      source: params.connection.slug,
      event: params.rawPayload.webhookEvent,
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

export function isJiraInstallationUsable(
  installation: JiraInstallation | undefined,
): installation is JiraInstallation {
  return installation?.status === 'installed';
}
