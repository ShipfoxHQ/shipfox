import {SLACK_PROVIDER} from '@shipfox/api-integration-slack-dto';
import {config} from '#config.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export type {SlackProvider} from '@shipfox/api-integration-slack-dto';
export {
  SlackBotTokenMissingError,
  SlackConnectionAlreadyLinkedError,
  SlackConnectionNotFoundError,
  SlackInstallationAlreadyLinkedError,
  SlackIntegrationProviderError,
} from '#core/errors.js';
export type {
  CreateSlackTokenStoreParams,
  GetSlackAccessTokenParams,
  SlackConnectionResolverResult,
  SlackSecretsStore,
  SlackTokenStore,
  StoreSlackTokensParams,
} from '#core/tokens.js';
export {createSlackTokenStore, slackSecretsNamespace} from '#core/tokens.js';
export type {
  SlackInstallation,
  SlackInstallationStatus,
  UpsertSlackInstallationParams,
} from '#db/installations.js';
export {
  getSlackInstallationByConnectionId,
  getSlackInstallationByTeamId,
  markSlackInstallationRevoked,
  upsertSlackInstallation,
} from '#db/installations.js';
export {closeDb, config, db, migrationsPath};

export function createSlackIntegrationProvider() {
  return {
    provider: SLACK_PROVIDER,
    displayName: 'Slack',
    adapters: {},
    routes: [],
  };
}
