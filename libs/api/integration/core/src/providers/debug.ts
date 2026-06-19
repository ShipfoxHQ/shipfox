import {config} from '#config.js';
import {
  listIntegrationConnectionsByProvider,
  upsertIntegrationConnection,
} from '#db/connections.js';
import {publishSourceCommitPushed} from '#db/webhook-deliveries.js';
import type {IntegrationProviderModule} from '#providers/types.js';

export const debugProviderModule: IntegrationProviderModule = {
  id: 'debug',
  enabled: config.INTEGRATIONS_ENABLE_DEBUG_PROVIDER,
  load: async () => {
    const {createDebugIntegrationProvider, emitDebugStartupResync} = await import(
      '@shipfox/api-integration-debug'
    );
    return {
      provider: createDebugIntegrationProvider({upsertIntegrationConnection}),
      startupTasks: [
        () =>
          emitDebugStartupResync({
            listConnections: async () =>
              (await listIntegrationConnectionsByProvider({provider: 'debug'}))
                .filter((connection) => connection.lifecycleStatus === 'active')
                .map((connection) => ({id: connection.id, workspaceId: connection.workspaceId})),
            publishSourceCommitPushed,
          }),
      ],
    };
  },
};
