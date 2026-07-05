import {config} from '#config.js';
import type {IntegrationProviderModule} from '#providers/types.js';

export const cronProviderModule: IntegrationProviderModule = {
  id: 'cron',
  enabled: config.INTEGRATIONS_ENABLE_CRON_PROVIDER,
  load: async () => ({
    provider: {
      provider: 'cron',
      displayName: 'Cron',
    },
  }),
};
