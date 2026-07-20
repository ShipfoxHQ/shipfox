import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {
  createLinearInstallBodySchema,
  createLinearInstallResponseSchema,
  type LinearCallbackQueryDto,
  linearCallbackQuerySchema,
  linearCallbackResponseSchema,
} from '@shipfox/api-integration-linear-dto';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {LinearApiClient} from '#api/client.js';
import {config} from '#config.js';
import {
  type ConnectLinearInstallationInput,
  handleLinearCallback,
  handleLinearOAuthCallbackError,
} from '#core/install.js';
import {formatLinearOAuthScopes} from '#core/scopes.js';
import {signLinearInstallState} from '#core/state.js';
import type {LinearTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {linearRouteErrorHandler} from './errors.js';

export interface CreateLinearIntegrationRoutesOptions {
  linear: LinearApiClient;
  tokenStore: Pick<LinearTokenStore, 'storeTokens'>;
  getExistingLinearConnection: (input: {
    organizationId: string;
  }) => Promise<IntegrationConnection<'linear'> | undefined>;
  connectLinearInstallation: (
    input: ConnectLinearInstallationInput,
  ) => Promise<IntegrationConnection<'linear'>>;
  disconnectLinearInstallation: (input: {connectionId: string}) => Promise<void>;
  connectionCapabilities: IntegrationCapability[];
  requireActiveWorkspaceMembership?: (input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
  }) => Promise<unknown>;
}

export function createLinearIntegrationRoutes({
  linear,
  tokenStore,
  getExistingLinearConnection,
  connectLinearInstallation,
  disconnectLinearInstallation,
  connectionCapabilities,
  requireActiveWorkspaceMembership,
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
      installUrl.searchParams.set('scope', formatLinearOAuthScopes());

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
      const query = request.query;
      if (isLinearOAuthErrorCallback(query)) {
        return await handleLinearOAuthCallbackError({
          state: query.state,
          error: query.error,
          errorDescription: query.error_description,
          sessionUserId: actor.userId,
          sessionMemberships: actor.memberships,
          requireWorkspaceMembership:
            requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck,
        });
      }
      const connection = await handleLinearCallback({
        linear,
        tokenStore,
        code: query.code,
        state: query.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership:
          requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck,
        getExistingLinearConnection,
        connectLinearInstallation,
        disconnectLinearInstallation,
      });

      return toIntegrationConnectionDto(connection, {capabilities: connectionCapabilities});
    },
  });

  return {
    prefix: '/integrations/linear',
    routes: [createInstallRoute, callbackApiRoute],
  };
}

function unavailableWorkspaceMembershipCheck(_input: {
  workspaceId: string;
  userId: string;
  memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
}): Promise<never> {
  return Promise.reject(new Error('Workspaces inter-module client is not configured'));
}

function isLinearOAuthErrorCallback(
  query: LinearCallbackQueryDto,
): query is LinearCallbackQueryDto & {
  error: string;
  error_description?: string | undefined;
  state: string;
} {
  return 'error' in query && typeof query.error === 'string';
}
