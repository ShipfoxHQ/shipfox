import {createDebugIntegrationProvider} from '@shipfox/api-integration-debug';
import {config} from '#config.js';
import {upsertIntegrationConnection} from '#db/connections.js';
import type {IntegrationProviderModule} from '#providers/types.js';

export const debugProviderModule: IntegrationProviderModule = {
  id: 'debug',
  enabled: config.INTEGRATIONS_ENABLE_DEBUG_PROVIDER,
  load: async () => ({
    provider: createDebugIntegrationProvider({upsertIntegrationConnection}),
  }),
};
