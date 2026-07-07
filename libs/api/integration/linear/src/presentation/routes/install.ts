import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {
  createLinearInstallBodySchema,
  createLinearInstallResponseSchema,
  linearCallbackQuerySchema,
  linearCallbackResponseSchema,
} from '@shipfox/api-integration-linear-dto';
import {requireWorkspaceMembership} from '@shipfox/api-workspaces';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {LinearApiClient} from '#api/client.js';
import {config} from '#config.js';
import {type ConnectLinearInstallationInput, handleLinearCallback} from '#core/install.js';
import {signLinearInstallState} from '#core/state.js';
import type {LinearTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {linearRouteErrorHandler} from './errors.js';

const LINEAR_OAUTH_SCOPES = ['read', 'write', 'app:assignable', 'app:mentionable'];

export interface CreateLinearIntegrationRoutesOptions {
  linear: LinearApiClient;
  tokenStore: Pick<LinearTokenStore, 'storeTokens'>;
  getExistingLinearConnection: (input: {
    organizationId: string;
  }) => Promise<IntegrationConnection<'linear'> | undefined>;
  connectLinearInstallation: (
    input: ConnectLinearInstallationInput,
  ) => Promise<IntegrationConnection<'linear'>>;
}

export function createLinearIntegrationRoutes({
  linear,
  tokenStore,
  getExistingLinearConnection,
  connectLinearInstallation,
}: CreateLinearIntegrationRoutesOptions): RouteGroup {
  const createInstallRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a Linear OAuth authorization URL for a workspace.',
    schema: {
      body: createLinearInstallBodySchema,
      response: {
        200: createLinearInstallResponseSchema,
      },
    },
    handler: (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);

      requireWorkspaceAccess({request, workspaceId});

      const state = signLinearInstallState({workspaceId, userId: actor.userId});
      const installUrl = new URL('https://linear.app/oauth/authorize');
      installUrl.searchParams.set('client_id', config.LINEAR_OAUTH_CLIENT_ID);
      installUrl.searchParams.set('redirect_uri', config.LINEAR_OAUTH_REDIRECT_URL);
      installUrl.searchParams.set('response_type', 'code');
      installUrl.searchParams.set('state', state);
      installUrl.searchParams.set('actor', 'app');
      installUrl.searchParams.set('scope', LINEAR_OAUTH_SCOPES.join(' '));

      return {install_url: installUrl.toString()};
    },
  });

  const callbackApiRoute = defineRoute({
    method: 'GET',
    path: '/callback/api',
    auth: AUTH_USER,
    description: 'Handle the Linear OAuth callback.',
    schema: {
      querystring: linearCallbackQuerySchema,
      response: {
        200: linearCallbackResponseSchema,
      },
    },
    errorHandler: linearRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const connection = await handleLinearCallback({
        linear,
        tokenStore,
        code: request.query.code,
        state: request.query.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership,
        getExistingLinearConnection,
        connectLinearInstallation,
      });

      return toIntegrationConnectionDto(connection);
    },
  });

  return {
    prefix: '/integrations/linear',
    routes: [createInstallRoute, callbackApiRoute],
  };
}
