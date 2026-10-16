import {CLAAP_PROVIDER} from '@shipfox/api-integration-claap-dto';
import type {AgentToolsProvider, IntegrationConnection} from '@shipfox/api-integration-spi';
import type {RouteExport} from '@shipfox/node-fastify';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateE2eClaapConnectionRouteOptions,
  createE2eClaapConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
import {
  type CreateClaapE2eRoutesOptions,
  createClaapE2eRoutes,
} from '#presentation/e2eRoutes/index.js';
import {createClaapConnectionRoutes} from '#presentation/routes/connections.js';

export type {ClaapProvider} from '@shipfox/api-integration-claap-dto';
export {
  type ClaapAgentToolId,
  type ClaapAgentToolRequiredScope,
  claapAgentToolCatalog,
  claapAgentToolSelectionCatalog,
  parseClaapRecordingUrl,
} from '#core/agent-tools.js';
export {
  ClaapAgentToolsProvider,
  type ClaapAgentToolsProviderOptions,
  rewriteClaapCall,
} from '#core/agent-tools-provider.js';
export type {
  ClaapConnectionCreator,
  CreateClaapConnectionInput,
  HandleClaapConnectParams,
} from '#core/connect.js';
export {assertClaapApiKey, handleClaapConnect} from '#core/connect.js';
export type {
  ClaapConnectionResolver,
  ClaapCredentialStore,
  ClaapSecretsStore,
} from '#core/credentials.js';
export {
  CLAAP_API_KEY_SECRET_NAME,
  claapSecretsNamespace,
  createClaapCredentialStore,
  createClaapCredentialStoreFromSecrets,
} from '#core/credentials.js';
export {
  ClaapAlreadyConnectedError,
  ClaapApiKeyMissingError,
  ClaapApiKeyPrefixError,
  ClaapConnectionNotFoundError,
  ClaapCredentialVersionMismatchError,
  ClaapInstallationNotFoundError,
  ClaapIntegrationProviderError,
  ClaapInvalidApiKeyError,
  ClaapUnexpectedWorkspaceCountError,
  ClaapWorkspaceMismatchError,
} from '#core/errors.js';
export {
  CLAAP_MCP_DEFAULT_ENDPOINT,
  type ClaapMcpClient,
  type ClaapWorkspace,
  type CreateClaapMcpClient,
  type CreateClaapMcpClientParams,
  createClaapMcpClient,
  listClaapWorkspaces,
} from '#core/mcp-client.js';
export type {ReplaceClaapApiKeyParams} from '#core/replace-key.js';
export {handleClaapReplaceApiKey} from '#core/replace-key.js';
export type {
  ClaapDatabaseExecutor,
  ClaapInstallation,
  ClaapVersionGuardResult,
  CreateClaapInstallationParams,
} from '#db/installations.js';
export {
  createClaapInstallation,
  deleteClaapInstallationByConnectionId,
  getClaapInstallationByConnectionId,
  updateClaapInstallationCredential,
  withClaapCredentialVersion,
  withClaapInstallationVersionGuard,
} from '#db/installations.js';
export type {CreateClaapConnectionRoutesOptions} from '#presentation/routes/connections.js';
export {
  CLAAP_PROVIDER,
  type CreateClaapE2eRoutesOptions,
  type CreateE2eClaapConnectionRouteOptions,
  closeDb,
  createClaapConnectionRoutes,
  createClaapE2eRoutes,
  createE2eClaapConnectionRoute,
  db,
  migrationsPath,
};

export interface CreateClaapIntegrationProviderOptions {
  agentTools?: AgentToolsProvider<IntegrationConnection<'claap'>> | undefined;
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

export function createClaapIntegrationProvider(
  options: CreateClaapIntegrationProviderOptions = {},
) {
  return {
    provider: CLAAP_PROVIDER,
    displayName: 'Claap',
    ...(options.agentTools ? {adapters: {agent_tools: options.agentTools}} : {}),
    ...(options.routes === undefined ? {} : {routes: options.routes}),
    ...options.cleanup,
  };
}
