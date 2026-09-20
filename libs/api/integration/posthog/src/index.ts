import {POSTHOG_PROVIDER, posthogExternalAccountId} from '@shipfox/api-integration-posthog-dto';
import type {AgentToolsProvider, IntegrationConnection} from '@shipfox/api-integration-spi';
import type {RouteExport} from '@shipfox/node-fastify';
import {createPosthogApiClient, posthogApiBaseUrl} from '#api/client.js';
import {closeDb, db} from '#db/db.js';
import {getPosthogInstallationByConnectionId} from '#db/installations.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateE2ePosthogConnectionRouteOptions,
  createE2ePosthogConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
import {
  type CreatePosthogE2eRoutesOptions,
  createPosthogE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
import {createPosthogConnectionRoutes} from '#presentation/routes/connections.js';

export type {PosthogProvider, PosthogRegion} from '@shipfox/api-integration-posthog-dto';
export {
  type CreatePosthogApiClientOptions,
  createPosthogApiClient,
  type PosthogApiClient,
  type PosthogCredentialProbeResult,
  type PosthogProject,
  posthogApiBase,
} from '#api/client.js';
export {
  type PosthogAgentToolId,
  type PosthogAgentToolRequiredScope,
  posthogAgentToolCatalog,
  posthogAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
export {
  type CreatePosthogMcpClient,
  type CreatePosthogMcpClientParams,
  PosthogAgentToolsProvider,
  type PosthogAgentToolsProviderOptions,
} from '#core/agent-tools-provider.js';
export type {
  ConnectPosthogInput,
  CreatePosthogConnectionInput,
  HandlePosthogConnectParams,
  PosthogConnectionCreator,
  PosthogConnectResult,
} from '#core/connect.js';
export {assertPersonalApiKey, handlePosthogConnect} from '#core/connect.js';
export type {
  PosthogConnectionResolver,
  PosthogCredentialStore,
  PosthogSecretsStore,
} from '#core/credentials.js';
export {
  createPosthogCredentialStore,
  createPosthogCredentialStoreFromSecrets,
  POSTHOG_API_KEY_SECRET_NAME,
  posthogSecretsNamespace,
} from '#core/credentials.js';
export {
  PosthogAlreadyConnectedError,
  PosthogApiKeyMissingError,
  PosthogApiKeyPrefixError,
  PosthogConnectionNotFoundError,
  PosthogCredentialVersionMismatchError,
  PosthogInstallationNotFoundError,
  PosthogIntegrationProviderError,
  PosthogNoProjectAccessError,
  PosthogProjectMismatchError,
  PosthogProjectNotAccessibleError,
} from '#core/errors.js';
export type {ReplacePosthogApiKeyParams} from '#core/replace-key.js';
export {handlePosthogReplaceApiKey} from '#core/replace-key.js';
export type {
  CreatePosthogInstallationParams,
  PosthogDatabaseExecutor,
  PosthogInstallation,
  PosthogVersionGuardResult,
} from '#db/installations.js';
export {
  createPosthogInstallation,
  deletePosthogInstallationByConnectionId,
  getPosthogInstallationByConnectionId,
  updatePosthogInstallationCredential,
  withPosthogCredentialVersion,
  withPosthogInstallationVersionGuard,
} from '#db/installations.js';
export type {CreatePosthogConnectionRoutesOptions} from '#presentation/routes/connections.js';
export {
  type CreateE2ePosthogConnectionRouteOptions,
  type CreatePosthogE2eRoutesOptions,
  closeDb,
  createE2ePosthogConnectionRoute,
  createPosthogApiClient,
  createPosthogConnectionRoutes,
  createPosthogE2eRoutes,
  db,
  migrationsPath,
  POSTHOG_PROVIDER,
  posthogApiBaseUrl,
  posthogExternalAccountId,
};

export interface CreatePosthogIntegrationProviderOptions {
  getPosthogInstallationByConnectionId?: typeof getPosthogInstallationByConnectionId | undefined;
  agentTools?: AgentToolsProvider<IntegrationConnection<'posthog'>> | undefined;
  routes?: RouteExport[];
  cleanup?:
    | {
        deleteConnectionRecords?: (
          connection: {id: string},
          options: {tx: unknown},
        ) => Promise<void>;
        deleteConnectionSecrets?: (connection: {id: string; workspaceId: string}) => Promise<void>;
      }
    | undefined;
}

export function createPosthogIntegrationProvider(
  options: CreatePosthogIntegrationProviderOptions = {},
) {
  const getInstallationByConnectionId =
    options.getPosthogInstallationByConnectionId ?? getPosthogInstallationByConnectionId;
  return {
    provider: POSTHOG_PROVIDER,
    displayName: 'PostHog',
    ...(options.agentTools ? {adapters: {agent_tools: options.agentTools}} : {}),
    async connectionExternalUrl(connection: {id: string}): Promise<string | undefined> {
      const installation = await getInstallationByConnectionId(connection.id);
      if (!installation) return undefined;
      return `https://${installation.region}.posthog.com/project/${encodeURIComponent(installation.projectId)}`;
    },
    ...(options.routes === undefined ? {} : {routes: options.routes}),
    ...options.cleanup,
  };
}
