import {JIRA_PROVIDER} from '@shipfox/api-integration-jira-dto';
import {config} from '#config.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export type {JiraProvider} from '@shipfox/api-integration-jira-dto';
export {
  JiraAccessTokenMissingError,
  JiraConnectionNotFoundError,
  JiraInstallationSiteMismatchError,
} from '#core/errors.js';
export type {
  CreateJiraTokenStoreParams,
  GetJiraAccessTokenParams,
  JiraConnectionResolverResult,
  JiraSecretsStore,
  JiraTokenStore,
  StoreJiraTokensParams,
} from '#core/tokens.js';
export {createJiraTokenStore, jiraSecretsNamespace} from '#core/tokens.js';
export type {
  JiraInstallation,
  JiraInstallationStatus,
  UpsertJiraInstallationParams,
} from '#db/installations.js';
export {
  getJiraInstallationByConnectionId,
  getJiraInstallationByWebhookId,
  markJiraInstallationRevoked,
  upsertJiraInstallation,
} from '#db/installations.js';
export {closeDb, config, db, migrationsPath};

export function createJiraIntegrationProvider() {
  return {provider: JIRA_PROVIDER, displayName: 'Jira'};
}
