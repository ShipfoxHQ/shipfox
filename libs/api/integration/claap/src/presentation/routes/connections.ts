import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  claapConnectBodySchema,
  claapConnectionResponseSchema,
  claapConnectResponseSchema,
  claapReplaceApiKeyBodySchema,
} from '@shipfox/api-integration-claap-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import {type ClaapConnectionCreator, handleClaapConnect} from '#core/connect.js';
import type {ClaapCredentialStore} from '#core/credentials.js';
import type {ClaapWorkspace} from '#core/mcp-client.js';
import {handleClaapReplaceApiKey} from '#core/replace-key.js';
import type {ClaapInstallation} from '#db/installations.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {claapRouteErrorHandler} from './errors.js';

const connectionParamsSchema = z.object({connectionId: z.string().uuid()});

export interface CreateClaapConnectionRoutesOptions {
  listClaapWorkspaces: (apiKey: string) => Promise<ClaapWorkspace[]>;
  credentials: ClaapCredentialStore;
  getExistingConnection: (input: {
    workspaceId: string;
    externalAccountId: string;
  }) => Promise<IntegrationConnection<'claap'> | undefined>;
  createConnection: ClaapConnectionCreator['createConnection'];
  getConnection: (connectionId: string) => Promise<IntegrationConnection<'claap'> | undefined>;
  getInstallation?: (connectionId: string) => Promise<ClaapInstallation | undefined>;
  updateConnection: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'claap'> | undefined>;
}

export function createClaapConnectionRoutes(
  options: CreateClaapConnectionRoutesOptions,
): RouteGroup {
  const connectRoute = defineRoute({
    method: 'POST',
    path: '/connect',
    auth: AUTH_USER,
    description: 'Connect a Claap workspace to a workspace.',
    schema: {
      body: claapConnectBodySchema,
      response: {200: claapConnectResponseSchema},
    },
    errorHandler: claapRouteErrorHandler,
    handler: async (request) => {
      const {workspace_id: workspaceId, api_key: apiKey} = request.body;
      requireWorkspaceAccess({request, workspaceId});
      const connection = await handleClaapConnect({
        workspaceId,
        apiKey,
        listClaapWorkspaces: options.listClaapWorkspaces,
        credentials: options.credentials,
        getExistingConnection: options.getExistingConnection,
        createConnection: options.createConnection,
      });
      return {connection: toIntegrationConnectionDto(connection)};
    },
  });

  const replaceRoute = defineRoute({
    method: 'PUT',
    path: '/connections/:connectionId/api-key',
    auth: AUTH_USER,
    description: 'Replace the API key for a Claap connection.',
    schema: {
      params: connectionParamsSchema,
      body: claapReplaceApiKeyBodySchema,
      response: {200: claapConnectionResponseSchema},
    },
    errorHandler: claapRouteErrorHandler,
    handler: async (request) => {
      const connection = await options.getConnection(request.params.connectionId);
      if (!connection)
        throw new ClientError('Integration connection not found', 'not-found', {status: 404});
      requireWorkspaceAccess({request, workspaceId: connection.workspaceId});
      const updated = await handleClaapReplaceApiKey({
        connectionId: connection.id,
        apiKey: request.body.api_key,
        listClaapWorkspaces: options.listClaapWorkspaces,
        credentials: options.credentials,
        getConnection: options.getConnection,
        ...(options.getInstallation === undefined
          ? {}
          : {getInstallation: options.getInstallation}),
        updateConnection: options.updateConnection,
      });
      return toIntegrationConnectionDto(updated);
    },
  });

  return {
    prefix: '/integrations/claap',
    routes: [connectRoute, replaceRoute],
  };
}
