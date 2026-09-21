import {NOTION_PROVIDER, notionEventCatalog} from '@shipfox/api-integration-notion-dto';
import {createNotionAgentToolsClient, type NotionAgentToolsClient} from '#api/client.js';
import {NotionAgentToolsProvider} from '#core/agent-tools-provider.js';
import type {NotionTokenStore} from '#core/tokens.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';

export type {NotionProvider} from '@shipfox/api-integration-notion-dto';
export type {
  NotionAgentToolHttpMethod,
  NotionAgentToolQueryValue,
  NotionAgentToolRequest,
  NotionAgentToolResponse,
  NotionAgentToolsClient,
  NotionApiClient,
  NotionAuthorization,
} from '#api/client.js';
export {createNotionAgentToolsClient, createNotionApiClient} from '#api/client.js';
export {config} from '#config.js';
export type {
  NotionAgentToolCatalogEntry,
  NotionAgentToolRequiredScope,
  NotionToolOperation,
} from '#core/agent-tools.js';
export {
  NOTION_TOOL_OPERATIONS,
  notionAgentToolCatalog,
  notionAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
export type {
  NotionAgentToolsProviderOptions,
  NotionIntegrationConnection,
  NotionToolCall,
} from '#core/agent-tools-provider.js';
export {NotionAgentToolsProvider} from '#core/agent-tools-provider.js';
export {prepareNotionTokenRevocation} from '#core/disconnect.js';
export {
  NotionAccessTokenMissingError,
  NotionConnectionNotFoundError,
  NotionIntegrationProviderError,
  NotionTokenUnrefreshableError,
} from '#core/errors.js';
export type {ConnectNotionInstallationInput} from '#core/install.js';
export {normalizeNotionId} from '#core/notion-id.js';
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
  withNotionGrantLock,
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
  agentTools?:
    | {
        tokenStore: Pick<NotionTokenStore, 'getAccessToken'>;
        notion?: NotionAgentToolsClient | undefined;
      }
    | undefined;
  cleanup?: {
    deleteConnectionRemoteResources?: (connection: {
      id: string;
      workspaceId: string;
    }) => Promise<(() => Promise<void>) | undefined>;
    withConnectionDeletionLock?: (
      connection: {id: string},
      fn: () => Promise<void>,
    ) => Promise<void>;
    deleteConnectionRecords?: (connection: {id: string}, options: {tx: unknown}) => Promise<void>;
    deleteConnectionSecrets?: (connection: {id: string; workspaceId: string}) => Promise<void>;
  };
}

export function createNotionIntegrationProvider(
  options: CreateNotionIntegrationProviderOptions = {},
) {
  const adapters = options.agentTools
    ? {
        agent_tools: new NotionAgentToolsProvider({
          notion: options.agentTools.notion ?? createNotionAgentToolsClient(),
          tokenStore: options.agentTools.tokenStore,
        }),
      }
    : {};
  return {
    provider: NOTION_PROVIDER,
    displayName: 'Notion',
    eventCatalog: notionEventCatalog,
    adapters,
    ...options.cleanup,
    routes: [],
    webhookProcessors: undefined,
  };
}
