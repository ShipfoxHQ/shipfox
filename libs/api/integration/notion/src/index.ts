import {NOTION_PROVIDER, notionEventCatalog} from '@shipfox/api-integration-notion-dto';
import {
  createNotionAgentToolsClient,
  createNotionApiClient,
  type NotionAgentToolsClient,
} from '#api/client.js';
import {NotionAgentToolsProvider} from '#core/agent-tools-provider.js';
import type {NotionTokenStore} from '#core/tokens.js';
import {createNotionWebhookProcessor} from '#core/webhook-processor.js';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateNotionIntegrationRoutesOptions,
  createNotionIntegrationRoutes,
} from '#presentation/routes/install.js';
import type {CreateNotionWebhookRoutesOptions} from '#presentation/routes/webhooks.js';
import {createNotionWebhookRoutes} from '#presentation/routes/webhooks.js';

export type {NotionProvider} from '@shipfox/api-integration-notion-dto';
export type {
  NotionAgentToolHttpMethod,
  NotionAgentToolQueryValue,
  NotionAgentToolRequest,
  NotionAgentToolResponse,
  NotionAgentToolsClient,
  NotionApiClient,
  NotionAuthorization,
  NotionOAuthAuthorization,
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
  NotionConnectionAlreadyLinkedError,
  NotionConnectionNotFoundError,
  NotionInstallationAlreadyLinkedError,
  NotionInstallStateActorMismatchError,
  NotionInstallStateError,
  NotionIntegrationProviderError,
  NotionOAuthCallbackError,
  NotionTokenUnrefreshableError,
} from '#core/errors.js';
export type {ConnectNotionInstallationInput, HandleNotionCallbackParams} from '#core/install.js';
export {handleNotionCallback, handleNotionOAuthCallbackError} from '#core/install.js';
export {normalizeNotionId} from '#core/notion-id.js';
export type {NotionInstallStateClaims} from '#core/state.js';
export {
  NOTION_INSTALL_STATE_TTL_SECONDS,
  signNotionInstallState,
  verifyNotionInstallState,
} from '#core/state.js';
export type {
  CreateNotionTokenStoreParams,
  DeleteNotionTokensParams,
  GetNotionAccessTokenParams,
  NotionConnectionResolverResult,
  NotionSecretsStore,
  NotionTokenPair,
  NotionTokenStore,
  StoreNotionTokensParams,
} from '#core/tokens.js';
export {createNotionTokenStore, notionSecretsNamespace} from '#core/tokens.js';
export type {
  CreateNotionWebhookProcessorOptions,
  NotionWebhookProcessor,
} from '#core/webhook-processor.js';
export {createNotionWebhookProcessor} from '#core/webhook-processor.js';
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
  restoreNotionInstallation,
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
export type {CreateNotionIntegrationRoutesOptions} from '#presentation/routes/install.js';
export {createNotionIntegrationRoutes} from '#presentation/routes/install.js';
export type {CreateNotionWebhookRoutesOptions} from '#presentation/routes/webhooks.js';
export {createNotionWebhookRoutes} from '#presentation/routes/webhooks.js';
export {closeDb, db, migrationsPath};

export interface CreateNotionIntegrationProviderOptions {
  agentTools?:
    | {
        tokenStore: Pick<NotionTokenStore, 'getAccessToken'>;
        notion?: NotionAgentToolsClient | undefined;
      }
    | undefined;
  routes?:
    | (Partial<CreateNotionIntegrationRoutesOptions> & Partial<CreateNotionWebhookRoutesOptions>)
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
  const oauthRoutesOptions =
    options.routes && hasNotionIntegrationRoutesOptions(options.routes)
      ? options.routes
      : undefined;
  const webhookRoutesOptions =
    options.routes && hasNotionWebhookRoutesOptions(options.routes) ? options.routes : undefined;
  const webhookProcessor = webhookRoutesOptions
    ? (webhookRoutesOptions.processor ?? createNotionWebhookProcessor(webhookRoutesOptions))
    : undefined;
  const routes = oauthRoutesOptions
    ? [
        createNotionIntegrationRoutes({
          ...oauthRoutesOptions,
          notion: oauthRoutesOptions.notion ?? createNotionApiClient(),
          connectionCapabilities: adapters.agent_tools ? ['agent_tools'] : [],
        }),
      ]
    : [];
  if (webhookProcessor && webhookRoutesOptions) {
    routes.push(createNotionWebhookRoutes({...webhookRoutesOptions, processor: webhookProcessor}));
  }

  return {
    provider: NOTION_PROVIDER,
    displayName: 'Notion',
    eventCatalog: notionEventCatalog,
    adapters,
    ...options.cleanup,
    routes,
    webhookProcessors: webhookProcessor
      ? [{routeIds: ['notion'] as const, processor: webhookProcessor}]
      : undefined,
  };
}

function hasNotionIntegrationRoutesOptions(
  routes: CreateNotionIntegrationProviderOptions['routes'],
): routes is CreateNotionIntegrationRoutesOptions {
  return (
    routes?.tokenStore !== undefined &&
    routes.getExistingNotionConnection !== undefined &&
    routes.getNotionInstallationByConnectionId !== undefined &&
    routes.connectNotionInstallation !== undefined &&
    routes.restoreNotionInstallation !== undefined &&
    routes.disconnectNotionInstallation !== undefined
  );
}

function hasNotionWebhookRoutesOptions(
  routes: Partial<CreateNotionWebhookRoutesOptions>,
): routes is CreateNotionWebhookRoutesOptions {
  return (
    routes.coreDb !== undefined &&
    routes.publishIntegrationEventReceived !== undefined &&
    routes.recordDeliveryOnly !== undefined &&
    routes.getIntegrationConnectionById !== undefined
  );
}
