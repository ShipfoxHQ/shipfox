import {config} from '#config.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const SLACK_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_slack';

async function loadSlackModuleParts(): Promise<IntegrationModuleParts> {
  const {
    createSlackIntegrationProvider,
    db: slackDb,
    migrationsPath: slackMigrationsPath,
  } = await import('@shipfox/api-integration-slack');

  return {
    provider: createSlackIntegrationProvider(),
    database: {
      db: slackDb,
      migrationsPath: slackMigrationsPath,
      migrationsTableName: SLACK_MIGRATIONS_TABLE,
    },
  };
}

export const slackProviderModule: IntegrationProviderModule = {
  id: 'slack',
  enabled: config.INTEGRATIONS_ENABLE_SLACK_PROVIDER,
  load: loadSlackModuleParts,
};
