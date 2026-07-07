import {config} from '#config.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const LINEAR_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_linear';

async function loadLinearModuleParts(): Promise<IntegrationModuleParts> {
  const {
    createLinearIntegrationProvider,
    db: linearDb,
    migrationsPath: linearMigrationsPath,
  } = await import('@shipfox/api-integration-linear');

  return {
    provider: createLinearIntegrationProvider(),
    database: {
      db: linearDb,
      migrationsPath: linearMigrationsPath,
      migrationsTableName: LINEAR_MIGRATIONS_TABLE,
    },
  };
}

export const linearProviderModule: IntegrationProviderModule = {
  id: 'linear',
  enabled: config.INTEGRATIONS_ENABLE_LINEAR_PROVIDER,
  load: loadLinearModuleParts,
};
