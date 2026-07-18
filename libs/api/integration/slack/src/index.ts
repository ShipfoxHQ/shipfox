import {SLACK_PROVIDER} from '@shipfox/api-integration-slack-dto';
import {config} from '#config.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateSlackWebhookRoutesOptions,
  createSlackWebhookRoutes,
} from '#presentation/routes/webhooks.js';

export type {SlackProvider} from '@shipfox/api-integration-slack-dto';
export {
  SlackBotTokenMissingError,
  SlackConnectionAlreadyLinkedError,
  SlackConnectionNotFoundError,
  SlackInstallationAlreadyLinkedError,
  SlackIntegrationProviderError,
} from '#core/errors.js';
export type {VerifySlackSignatureParams} from '#core/signature.js';
export {verifySlackSignature} from '#core/signature.js';
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
  HandleSlackCommandParams,
  HandleSlackEventParams,
  SlackWebhookOutcome,
} from '#core/webhook.js';
export {handleSlackCommand, handleSlackEvent, isSelfAuthoredSlackEvent} from '#core/webhook.js';
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
export {
  type CreateSlackWebhookRoutesOptions,
  createSlackWebhookRoutes,
  SLACK_WEBHOOK_BODY_LIMIT,
  SLASH_COMMAND_ACK,
} from '#presentation/routes/webhooks.js';
export {closeDb, config, db, migrationsPath};

export interface CreateSlackIntegrationProviderOptions {
  routes?: Partial<CreateSlackWebhookRoutesOptions> | undefined;
}

export function createSlackIntegrationProvider(
  options: CreateSlackIntegrationProviderOptions = {},
) {
  if (options.routes && !hasSlackWebhookRoutesOptions(options.routes)) {
    throw new Error('Slack webhook routes require every core persistence dependency');
  }
  const routes = options.routes ? createSlackWebhookRoutes(options.routes) : [];

  return {
    provider: SLACK_PROVIDER,
    displayName: 'Slack',
    adapters: {},
    routes,
  };
}

function hasSlackWebhookRoutesOptions(
  routes: Partial<CreateSlackWebhookRoutesOptions>,
): routes is CreateSlackWebhookRoutesOptions {
  return (
    routes.coreDb !== undefined &&
    routes.publishIntegrationEventReceived !== undefined &&
    routes.recordDeliveryOnly !== undefined &&
    routes.getIntegrationConnectionById !== undefined
  );
}
