import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {
  createGiteaConnectionBodySchema,
  createGiteaConnectionResponseSchema,
} from '@shipfox/api-integration-gitea-dto';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {GiteaApiClient} from '#api/client.js';
import {type ConnectGiteaConnectionInput, handleGiteaConnect} from '#core/connect.js';
import {giteaConnectionExternalUrl} from '#core/connection-url.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {giteaRouteErrorHandler} from './errors.js';

export interface CreateGiteaConnectionRoutesOptions {
  gitea: GiteaApiClient;
  getExistingGiteaConnection: (input: {
    org: string;
  }) => Promise<IntegrationConnection<'gitea'> | undefined>;
  connectGiteaConnection: (
    input: ConnectGiteaConnectionInput,
  ) => Promise<IntegrationConnection<'gitea'>>;
}

export function createGiteaConnectionRoutes({
  gitea,
  getExistingGiteaConnection,
  connectGiteaConnection,
}: CreateGiteaConnectionRoutesOptions): RouteGroup {
  const createConnectionRoute = defineRoute({
    method: 'POST',
    path: '/connections',
    auth: AUTH_USER,
    description: 'Connect a Gitea organization to a workspace.',
    schema: {
      body: createGiteaConnectionBodySchema,
      response: {
        200: createGiteaConnectionResponseSchema,
      },
    },
    errorHandler: giteaRouteErrorHandler,
    handler: async (request) => {
      const {workspace_id: workspaceId, org} = request.body;

      requireWorkspaceAccess({request, workspaceId});
      const connection = await handleGiteaConnect({
        gitea,
        workspaceId,
        org,
        getExistingGiteaConnection,
        connectGiteaConnection,
      });

      return toIntegrationConnectionDto(connection, {
        externalUrl: giteaConnectionExternalUrl(connection.externalAccountId),
      });
    },
  });

  return {
    prefix: '/integrations/gitea',
    routes: [createConnectionRoute],
  };
}
