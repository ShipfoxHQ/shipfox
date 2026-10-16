import {JAM_PROVIDER} from '@shipfox/api-integration-jam-dto';
import type {AgentToolsProvider, IntegrationConnection} from '@shipfox/api-integration-spi';
import type {RouteExport} from '@shipfox/node-fastify';
import {closeDb, db} from '#db/db.js';
import {migrationsPath} from '#db/migrations.js';
import {
  type CreateE2eJamConnectionRouteOptions,
  createE2eJamConnectionRoute,
} from '#presentation/e2eRoutes/create-connection.js';
import {type CreateJamE2eRoutesOptions, createJamE2eRoutes} from '#presentation/e2eRoutes/index.js';
import {createJamConnectionRoutes} from '#presentation/routes/connections.js';

export type {JamProvider} from '@shipfox/api-integration-jam-dto';
export {
  type CreateJamIntrospectionClientOptions,
  createJamIntrospectionClient,
  DEFAULT_JAM_API_BASE_URL,
  type JamIntrospection,
  type JamIntrospectionClient,
} from '#api/introspect.js';
export {
  type JamAgentToolId,
  type JamAgentToolRequiredScope,
  jamAgentToolCatalog,
  jamAgentToolSelectionCatalog,
} from '#core/agent-tools.js';
export {
  JamAgentToolsProvider,
  type JamAgentToolsProviderOptions,
} from '#core/agent-tools-provider.js';
export type {
  CreateJamConnectionInput,
  HandleJamConnectParams,
  JamConnectionCreator,
  JamConnectResult,
} from '#core/connect.js';
export {handleJamConnect} from '#core/connect.js';
export type {
  JamConnectionResolver,
  JamCredentialStore,
  JamSecretsStore,
} from '#core/credentials.js';
export {
  createJamCredentialStore,
  JAM_ACCESS_TOKEN_SECRET_NAME,
  jamSecretsNamespace,
} from '#core/credentials.js';
export {
  JamAlreadyConnectedError,
  JamConnectionNotFoundError,
  JamCredentialVersionMismatchError,
  JamInstallationNotFoundError,
  JamIntegrationProviderError,
  JamInvalidTokenError,
  JamMcpUnavailableError,
  JamMissingReadScopeError,
  JamTokenMissingError,
  JamTokenPrefixError,
  JamWorkspaceMismatchError,
} from '#core/errors.js';
export {
  type CreateJamMcpClient,
  type CreateJamMcpClientParams,
  DEFAULT_JAM_MCP_ENDPOINT,
  type JamMcpClient,
} from '#core/mcp-client.js';
export type {ReplaceJamTokenParams} from '#core/replace-token.js';
export {handleJamReplaceToken} from '#core/replace-token.js';
export {
  assertJamTokenPrefix,
  createJamTokenValidator,
  type ValidatedJamToken,
  type ValidateJamTokenParams,
  validateJamToken,
} from '#core/validate-token.js';
export type {
  CreateJamInstallationParams,
  JamDatabaseExecutor,
  JamInstallation,
  JamInstallationIdentity,
  JamVersionGuardResult,
} from '#db/installations.js';
export {
  createJamInstallation,
  deleteJamInstallationByConnectionId,
  getJamInstallationByConnectionId,
  updateJamInstallationCredential,
  withJamCredentialVersion,
} from '#db/installations.js';
export type {CreateJamConnectionRoutesOptions} from '#presentation/routes/connections.js';
export {
  type CreateE2eJamConnectionRouteOptions,
  type CreateJamE2eRoutesOptions,
  closeDb,
  createE2eJamConnectionRoute,
  createJamConnectionRoutes,
  createJamE2eRoutes,
  db,
  JAM_PROVIDER,
  migrationsPath,
};

export interface CreateJamIntegrationProviderOptions {
  agentTools?: AgentToolsProvider<IntegrationConnection<'jam'>> | undefined;
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

export function createJamIntegrationProvider(options: CreateJamIntegrationProviderOptions = {}) {
  return {
    provider: JAM_PROVIDER,
    displayName: 'Jam',
    ...(options.agentTools ? {adapters: {agent_tools: options.agentTools}} : {}),
    ...(options.routes === undefined ? {} : {routes: options.routes}),
    ...options.cleanup,
  };
}
