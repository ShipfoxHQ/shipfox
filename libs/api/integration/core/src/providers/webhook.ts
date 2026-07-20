import {config} from '#config.js';
import {
  createIntegrationConnection,
  deleteIntegrationConnection,
  getIntegrationConnectionById,
  listIntegrationConnections,
  updateIntegrationConnectionLifecycleStatus,
} from '#db/connections.js';
import {db} from '#db/db.js';
import {publishIntegrationEventReceived} from '#db/webhook-deliveries.js';
import type {IntegrationProviderModule} from '#providers/types.js';

export const webhookProviderModule: IntegrationProviderModule = {
  id: 'webhook',
  enabled: config.INTEGRATIONS_ENABLE_WEBHOOK_PROVIDER,
  load: async () => {
    const {createWebhookIntegrationProvider} = await import('@shipfox/api-integration-webhook');
    const integrationProvider = createWebhookIntegrationProvider({
      coreDb: db,
      createIntegrationConnection,
      listIntegrationConnections,
      getIntegrationConnectionById,
      updateIntegrationConnectionLifecycleStatus,
      deleteIntegrationConnection,
      publishIntegrationEventReceived,
    });
    return {
      provider: integrationProvider,
      webhookProcessors: integrationProvider.webhookProcessors,
    };
  },
};
