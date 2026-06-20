import {config} from '#config.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

// Stable migration-tracking table name for the Gitea provider database. This
// must NOT depend on the provider's position in the module `database` array. A
// positional name would shift if a provider is flag-disabled and silently
// re-run migrations against existing tables.
const GITEA_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_gitea';

async function loadGiteaModuleParts(): Promise<IntegrationModuleParts> {
  const {
    createGiteaIntegrationProvider,
    db: giteaDb,
    migrationsPath: giteaMigrationsPath,
  } = await import('@shipfox/api-integration-gitea');

  return {
    provider: createGiteaIntegrationProvider(),
    database: {
      db: giteaDb,
      migrationsPath: giteaMigrationsPath,
      migrationsTableName: GITEA_MIGRATIONS_TABLE,
    },
  };
}

export const giteaProviderModule: IntegrationProviderModule = {
  id: 'gitea',
  enabled: config.INTEGRATIONS_ENABLE_GITEA_PROVIDER,
  load: loadGiteaModuleParts,
};
