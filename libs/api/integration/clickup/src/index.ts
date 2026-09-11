import {CLICKUP_PROVIDER, clickupEventCatalog} from '@shipfox/api-integration-clickup-dto';
import {config} from '#config.js';
import {createClickUpWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import type {CreateClickUpWebhookRoutesOptions} from '#presentation/routes/webhooks.js';
import {createClickUpWebhookRoutes} from '#presentation/routes/webhooks.js';

export type {ClickUpProvider} from '@shipfox/api-integration-clickup-dto';
export {
  ClickUpAccessTokenMissingError,
  ClickUpConnectionAlreadyLinkedError,
  ClickUpConnectionNotFoundError,
  ClickUpInstallationAlreadyLinkedError,
} from '#core/errors.js';
export type {
  ClickUpConnectionResolverResult,
  ClickUpSecretsStore,
  ClickUpTokenStore,
  CreateClickUpTokenStoreParams,
  GetClickUpAccessTokenParams,
  GetClickUpWebhookSecretParams,
  StoreClickUpTokensParams,
} from '#core/tokens.js';
export {clickupSecretsNamespace, createClickUpTokenStore} from '#core/tokens.js';
export {handleClickUpWebhook} from '#core/webhook.js';
export type {
  ClickUpWebhookProcessor,
  CreateClickUpWebhookProcessorOptions,
} from '#core/webhook-processor.js';
export {createClickUpWebhookProcessor} from '#core/webhook-processor.js';
export {CLICKUP_WEBHOOK_ROUTE_PREFIX, clickupWebhookUrl} from '#core/webhook-url.js';
export type {
  ClickUpInstallation,
  ClickUpInstallationLock,
  ClickUpInstallationStatus,
  UpsertClickUpInstallationParams,
} from '#db/installations.js';
export {
  deleteClickUpInstallationByConnectionId,
  getClickUpInstallationByConnectionId,
  getClickUpInstallationByTeamId,
  markClickUpInstallationRevoked,
  upsertClickUpInstallation,
  withClickUpInstallationLock,
  withClickUpWorkspaceLock,
} from '#db/installations.js';
export {
  type ConnectClickUpInstallationInput,
  type CreateE2eClickUpConnectionRouteOptions,
  createE2eClickUpConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
export {
  type CreateClickUpE2eRoutesOptions,
  createClickUpE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
export type {CreateClickUpWebhookRoutesOptions} from '#presentation/routes/webhooks.js';
export {createClickUpWebhookRoutes} from '#presentation/routes/webhooks.js';
export {closeDb, config, db, migrationsPath};

export interface CreateClickUpIntegrationProviderOptions {
  routes?: Omit<CreateClickUpWebhookRoutesOptions, 'processor'> | undefined;
  cleanup?:
    | {
        withConnectionDeletionLock?: (
          connection: {id: string},
          fn: () => Promise<void>,
        ) => Promise<void>;
        deleteConnectionRecords?: (
          connection: {id: string},
          options: {tx: unknown},
        ) => Promise<void>;
        deleteConnectionSecrets?: (connection: {id: string; workspaceId: string}) => Promise<void>;
      }
    | undefined;
}

export function createClickUpIntegrationProvider(
  options: CreateClickUpIntegrationProviderOptions = {},
) {
  const webhookProcessor = options.routes
    ? createClickUpWebhookProcessor(options.routes)
    : undefined;
  return {
    provider: CLICKUP_PROVIDER,
    displayName: 'ClickUp',
    eventCatalog: clickupEventCatalog,
    adapters: {},
    ...options.cleanup,
    routes: options.routes
      ? [createClickUpWebhookRoutes({...options.routes, processor: webhookProcessor})]
      : [],
    webhookProcessors: webhookProcessor
      ? [{routeIds: ['clickup'] as const, processor: webhookProcessor}]
      : undefined,
  };
}
