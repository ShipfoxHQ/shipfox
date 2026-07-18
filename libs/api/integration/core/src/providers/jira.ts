import {config} from '#config.js';
import type {IntegrationModuleParts, IntegrationProviderModule} from '#providers/types.js';

const JIRA_MIGRATIONS_TABLE = '__drizzle_migrations_integrations_jira';

async function loadJiraModuleParts(): Promise<IntegrationModuleParts> {
  const {
    createJiraIntegrationProvider,
    db: jiraDb,
    migrationsPath,
  } = await import('@shipfox/api-integration-jira');

  return {
    provider: createJiraIntegrationProvider(),
    database: {
      db: jiraDb,
      migrationsPath,
      migrationsTableName: JIRA_MIGRATIONS_TABLE,
    },
  };
}

export const jiraProviderModule: IntegrationProviderModule = {
  id: 'jira',
  enabled: config.INTEGRATIONS_ENABLE_JIRA_PROVIDER,
  load: loadJiraModuleParts,
};
