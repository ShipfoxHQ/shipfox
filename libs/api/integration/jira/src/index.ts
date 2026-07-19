import {JIRA_PROVIDER} from '@shipfox/api-integration-jira-dto';
import {createJiraApiClient, type JiraApiClient} from '#api/client.js';
import {config} from '#config.js';
import {closeDb, db} from '#db/db.js';
import {getJiraInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateJiraIntegrationRoutesOptions,
  createJiraIntegrationRoutes,
} from '#presentation/routes/install.js';

export type {JiraProvider} from '@shipfox/api-integration-jira-dto';
export type {
  JiraAccessibleResource,
  JiraApiClient,
  JiraAuthorization,
  JiraIdentity,
} from '#api/client.js';
export {createJiraApiClient, mapJiraError} from '#api/client.js';
export type {DisconnectJiraInstallationParams} from '#core/disconnect.js';
export {disconnectJiraInstallation} from '#core/disconnect.js';
export {
  JiraAccessTokenMissingError,
  JiraAuthorizationScopeMismatchError,
  JiraConnectionAlreadyLinkedError,
  JiraConnectionNotFoundError,
  JiraInstallationAlreadyLinkedError,
  JiraInstallationSiteMismatchError,
  JiraInstallStateActorMismatchError,
  JiraInstallStateError,
  JiraIntegrationProviderError,
  JiraOAuthCallbackError,
  JiraOfflineAccessNotGrantedError,
  JiraPendingSelectionNotFoundError,
  JiraSiteSelectionMismatchError,
  JiraTokenUnrefreshableError,
} from '#core/errors.js';
export type {ConnectJiraInstallationInput, HandleJiraCallbackParams} from '#core/install.js';
export {
  handleJiraCallback,
  handleJiraOAuthCallbackError,
  handleJiraSiteSelection,
} from '#core/install.js';
export type {JiraPendingSelectionSecretsStore, JiraPendingSelectionStore} from '#core/pending.js';
export {createJiraPendingSelectionStore, jiraPendingSecretsNamespace} from '#core/pending.js';
export {
  assertJiraAuthorizationScopes,
  formatJiraOAuthScopes,
  JIRA_OAUTH_SCOPES,
} from '#core/scopes.js';
export {signJiraInstallState, verifyJiraInstallState} from '#core/state.js';
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
  deleteJiraInstallationByConnectionId,
  getJiraInstallationByCloudId,
  getJiraInstallationByConnectionId,
  getJiraInstallationByWebhookId,
  markJiraInstallationRevoked,
  updateJiraInstallationTokenExpiry,
  upsertJiraInstallation,
  withJiraRefreshLock,
} from '#db/installations.js';
export {closeDb, config, db, migrationsPath};

export interface CreateJiraIntegrationProviderOptions {
  jira?: JiraApiClient | undefined;
  getJiraInstallationByConnectionId?: typeof getJiraInstallationByConnectionId | undefined;
  routes?: Omit<CreateJiraIntegrationRoutesOptions, 'jira' | 'connectionCapabilities'> | undefined;
}

export function createJiraIntegrationProvider(options: CreateJiraIntegrationProviderOptions = {}) {
  const jira = options.jira ?? createJiraApiClient();
  const getInstallationByConnectionId =
    options.getJiraInstallationByConnectionId ?? getJiraInstallationByConnectionId;
  const routes = options.routes
    ? [createJiraIntegrationRoutes({jira, connectionCapabilities: [], ...options.routes})]
    : [];
  return {
    provider: JIRA_PROVIDER,
    displayName: 'Jira',
    adapters: {},
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      return (await getInstallationByConnectionId(connection.id))?.siteUrl;
    },
    routes,
  };
}
