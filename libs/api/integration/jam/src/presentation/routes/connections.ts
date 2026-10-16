import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  jamConnectBodySchema,
  jamConnectionResponseSchema,
  jamConnectResponseSchema,
  jamReplaceTokenBodySchema,
} from '@shipfox/api-integration-jam-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import {handleJamConnect, type JamConnectionCreator} from '#core/connect.js';
import type {JamCredentialStore} from '#core/credentials.js';
import {JamAlreadyConnectedError} from '#core/errors.js';
import {handleJamReplaceToken} from '#core/replace-token.js';
import type {ValidatedJamToken} from '#core/validate-token.js';
import type {JamInstallation} from '#db/installations.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {jamRouteErrorHandler} from './errors.js';

const connectionParamsSchema = z.object({connectionId: z.string().uuid()});

export interface CreateJamConnectionRoutesOptions {
  validateToken: (token: string) => Promise<ValidatedJamToken>;
  credentials: JamCredentialStore;
  getExistingConnection: (input: {
    workspaceId: string;
    externalAccountId: string;
  }) => Promise<IntegrationConnection<'jam'> | undefined>;
  createConnection: JamConnectionCreator['createConnection'];
  getConnection: (connectionId: string) => Promise<IntegrationConnection<'jam'> | undefined>;
  getInstallation?: (connectionId: string) => Promise<JamInstallation | undefined>;
  updateConnection: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'jam'> | undefined>;
}

export function createJamConnectionRoutes(options: CreateJamConnectionRoutesOptions): RouteGroup {
  const connectRoute = defineRoute({
    method: 'POST',
    path: '/connect',
    auth: AUTH_USER,
    description: 'Connect a Jam workspace to a workspace with a personal access token.',
    schema: {
      body: jamConnectBodySchema,
      response: {200: jamConnectResponseSchema},
    },
    errorHandler: jamRouteErrorHandler,
    handler: async (request) => {
      const {workspace_id: workspaceId, token} = request.body;
      requireWorkspaceAccess({request, workspaceId});
      const result = await handleJamConnect({
        workspaceId,
        token,
        validateToken: options.validateToken,
        credentials: options.credentials,
        getExistingConnection: options.getExistingConnection,
        createConnection: options.createConnection,
      });
      if (result.status === 'already-connected') {
        throw new JamAlreadyConnectedError(result.connectionId);
      }
      return {connection: toIntegrationConnectionDto(result.connection)};
    },
  });

  const replaceRoute = defineRoute({
    method: 'PUT',
    path: '/connections/:connectionId/token',
    auth: AUTH_USER,
    description: 'Replace the personal access token for a Jam connection.',
    schema: {
      params: connectionParamsSchema,
      body: jamReplaceTokenBodySchema,
      response: {200: jamConnectionResponseSchema},
    },
    errorHandler: jamRouteErrorHandler,
    handler: async (request) => {
      const connection = await options.getConnection(request.params.connectionId);
      if (!connection)
        throw new ClientError('Integration connection not found', 'not-found', {status: 404});
      requireWorkspaceAccess({request, workspaceId: connection.workspaceId});
      const updated = await handleJamReplaceToken({
        connection,
        token: request.body.token,
        validateToken: options.validateToken,
        credentials: options.credentials,
        ...(options.getInstallation === undefined
          ? {}
          : {getInstallation: options.getInstallation}),
        updateConnection: options.updateConnection,
      });
      return toIntegrationConnectionDto(updated);
    },
  });

  return {
    prefix: '/integrations/jam',
    routes: [connectRoute, replaceRoute],
  };
}
