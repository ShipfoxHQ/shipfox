import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  posthogConnectBodySchema,
  posthogConnectionResponseSchema,
  posthogConnectResponseSchema,
  posthogReplaceApiKeyBodySchema,
} from '@shipfox/api-integration-posthog-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {z} from 'zod';
import type {PosthogApiClient} from '#api/client.js';
import {handlePosthogConnect, type PosthogConnectionCreator} from '#core/connect.js';
import type {PosthogCredentialStore} from '#core/credentials.js';
import {PosthogAlreadyConnectedError} from '#core/errors.js';
import {handlePosthogReplaceApiKey} from '#core/replace-key.js';
import type {PosthogInstallation} from '#db/installations.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {posthogRouteErrorHandler} from './errors.js';

const connectionParamsSchema = z.object({connectionId: z.string().uuid()});

export interface CreatePosthogConnectionRoutesOptions {
  posthog: PosthogApiClient;
  credentials: PosthogCredentialStore;
  getExistingConnection: (input: {
    workspaceId: string;
    externalAccountId: string;
  }) => Promise<IntegrationConnection<'posthog'> | undefined>;
  createConnection: PosthogConnectionCreator['createConnection'];
  getConnection: (connectionId: string) => Promise<IntegrationConnection<'posthog'> | undefined>;
  getInstallation?: (connectionId: string) => Promise<PosthogInstallation | undefined>;
  updateConnection: (params: {
    id: string;
    lifecycleStatus: 'active';
    tx: unknown;
  }) => Promise<IntegrationConnection<'posthog'> | undefined>;
}

export function createPosthogConnectionRoutes(
  options: CreatePosthogConnectionRoutesOptions,
): RouteGroup {
  const connectRoute = defineRoute({
    method: 'POST',
    path: '/connect',
    auth: AUTH_USER,
    description: 'Connect a PostHog project to a workspace.',
    schema: {
      body: posthogConnectBodySchema,
      response: {200: posthogConnectResponseSchema},
    },
    errorHandler: posthogRouteErrorHandler,
    handler: async (request) => {
      const {
        workspace_id: workspaceId,
        region,
        api_key: apiKey,
        project_id: projectId,
      } = request.body;
      requireWorkspaceAccess({request, workspaceId});
      const result = await handlePosthogConnect({
        posthog: options.posthog,
        credentials: options.credentials,
        workspaceId,
        region,
        apiKey,
        projectId,
        getExistingConnection: options.getExistingConnection,
        createConnection: options.createConnection,
      });
      if (result.status === 'select-project') {
        return {status: result.status, projects: result.projects.map(({id, name}) => ({id, name}))};
      }
      if (result.status === 'already-connected') {
        throw new PosthogAlreadyConnectedError(result.connectionId);
      }
      return {status: result.status, connection: toIntegrationConnectionDto(result.connection)};
    },
  });

  const replaceRoute = defineRoute({
    method: 'PUT',
    path: '/connections/:connectionId/api-key',
    auth: AUTH_USER,
    description: 'Replace the API key for a PostHog connection.',
    schema: {
      params: connectionParamsSchema,
      body: posthogReplaceApiKeyBodySchema,
      response: {200: posthogConnectionResponseSchema},
    },
    errorHandler: posthogRouteErrorHandler,
    handler: async (request) => {
      const connection = await options.getConnection(request.params.connectionId);
      if (!connection)
        throw new ClientError('Integration connection not found', 'not-found', {status: 404});
      requireWorkspaceAccess({request, workspaceId: connection.workspaceId});
      const updated = await handlePosthogReplaceApiKey({
        connectionId: connection.id,
        apiKey: request.body.api_key,
        posthog: options.posthog,
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
    prefix: '/integrations/posthog',
    routes: [connectRoute, replaceRoute],
  };
}
