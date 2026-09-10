import {CLICKUP_PROVIDER, clickupEventCatalog} from '@shipfox/api-integration-clickup-dto';
import {config} from '#config.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

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
  type ConnectClickUpInstallationInput,
  type CreateE2eClickUpConnectionRouteOptions,
  createE2eClickUpConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
export {
  type CreateClickUpE2eRoutesOptions,
  createClickUpE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
export {closeDb, config, db, migrationsPath};

export interface CreateClickUpIntegrationProviderOptions {
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
  return {
    provider: CLICKUP_PROVIDER,
    displayName: 'ClickUp',
    eventCatalog: clickupEventCatalog,
    adapters: {},
    ...options.cleanup,
    routes: [],
  };
}
