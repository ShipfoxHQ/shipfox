import {NOTION_PROVIDER, notionEventCatalog} from '@shipfox/api-integration-notion-dto';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export type {NotionProvider} from '@shipfox/api-integration-notion-dto';
export {config} from '#config.js';
export {NotionAccessTokenMissingError, NotionConnectionNotFoundError} from '#core/errors.js';
export type {ConnectNotionInstallationInput} from '#core/install.js';
export type {
  CreateNotionTokenStoreParams,
  DeleteNotionTokensParams,
  GetNotionAccessTokenParams,
  NotionConnectionResolverResult,
  NotionSecretsStore,
  NotionTokenStore,
  StoreNotionTokensParams,
} from '#core/tokens.js';
export {createNotionTokenStore, notionSecretsNamespace} from '#core/tokens.js';
export type {
  NotionInstallation,
  NotionInstallationStatus,
  UpsertNotionInstallationParams,
} from '#db/installations.js';
export {
  deleteNotionInstallationByConnectionId,
  getNotionInstallationByConnectionId,
  getNotionInstallationByWorkspaceId,
  markNotionInstallationRevoked,
  updateNotionInstallationTokenExpiry,
  upsertNotionInstallation,
} from '#db/installations.js';
export {
  type CreateE2eNotionConnectionRouteOptions,
  createE2eNotionConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
export {
  type CreateNotionE2eRoutesOptions,
  createNotionE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
export {closeDb, db, migrationsPath};

export interface CreateNotionIntegrationProviderOptions {
  cleanup?: {
    deleteConnectionRecords?: (connection: {id: string}, options: {tx: unknown}) => Promise<void>;
    deleteConnectionSecrets?: (connection: {id: string; workspaceId: string}) => Promise<void>;
  };
}

export function createNotionIntegrationProvider(
  options: CreateNotionIntegrationProviderOptions = {},
) {
  return {
    provider: NOTION_PROVIDER,
    displayName: 'Notion',
    eventCatalog: notionEventCatalog,
    adapters: {},
    ...options.cleanup,
    routes: [],
    webhookProcessors: undefined,
  };
}
