import {CLICKUP_PROVIDER, clickupEventCatalog} from '@shipfox/api-integration-clickup-dto';
import {type ClickUpApiClient, createClickUpApiClient} from '#api/client.js';
import {config} from '#config.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateClickUpIntegrationRoutesOptions,
  createClickUpIntegrationRoutes,
} from '#presentation/routes/install.js';

export type {ClickUpProvider} from '@shipfox/api-integration-clickup-dto';
export type {
  ClickUpApiClient,
  ClickUpAuthorization,
  ClickUpAuthorizedUser,
  ClickUpAuthorizedWorkspace,
} from '#api/client.js';
export {createClickUpApiClient, mapClickUpError} from '#api/client.js';
export {
  ClickUpAccessTokenMissingError,
  ClickUpConnectionAlreadyLinkedError,
  ClickUpConnectionNotFoundError,
  ClickUpInstallationAlreadyLinkedError,
  ClickUpInstallStateActorMismatchError,
  ClickUpInstallStateError,
  ClickUpIntegrationProviderError,
  ClickUpOAuthCallbackError,
  ClickUpWorkspaceCountError,
} from '#core/errors.js';
export type {ConnectClickUpInstallationInput, HandleClickUpCallbackParams} from '#core/install.js';
export {
  handleClickUpCallback,
  handleClickUpOAuthCallbackError,
} from '#core/install.js';
export type {ClickUpInstallStateClaims} from '#core/state.js';
export {signClickUpInstallState, verifyClickUpInstallState} from '#core/state.js';
export type {
  ClickUpConnectionResolverResult,
  ClickUpSecretsStore,
  ClickUpTokenStore,
  CreateClickUpTokenStoreParams,
  GetClickUpAccessTokenParams,
  StoreClickUpTokensParams,
} from '#core/tokens.js';
export {clickupSecretsNamespace, createClickUpTokenStore} from '#core/tokens.js';
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
  type CreateE2eClickUpConnectionRouteOptions,
  createE2eClickUpConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
export {
  type CreateClickUpE2eRoutesOptions,
  createClickUpE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
export type {CreateClickUpIntegrationRoutesOptions} from '#presentation/routes/install.js';
export {createClickUpIntegrationRoutes} from '#presentation/routes/install.js';
export {closeDb, config, db, migrationsPath};

export interface CreateClickUpIntegrationProviderOptions {
  clickup?: ClickUpApiClient | undefined;
  routes?:
    | Omit<CreateClickUpIntegrationRoutesOptions, 'clickup' | 'connectionCapabilities'>
    | undefined;
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
  const clickup = options.clickup ?? createClickUpApiClient();
  const routes = options.routes
    ? [
        createClickUpIntegrationRoutes({
          clickup,
          ...options.routes,
          connectionCapabilities: [],
        }),
      ]
    : [];
  return {
    provider: CLICKUP_PROVIDER,
    displayName: 'ClickUp',
    eventCatalog: clickupEventCatalog,
    adapters: {},
    ...options.cleanup,
    routes,
  };
}
