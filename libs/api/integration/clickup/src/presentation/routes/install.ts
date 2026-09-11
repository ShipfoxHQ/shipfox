import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  type ClickUpCallbackQueryDto,
  clickupCallbackQuerySchema,
  clickupCallbackResponseSchema,
  createClickUpInstallBodySchema,
  createClickUpInstallResponseSchema,
} from '@shipfox/api-integration-clickup-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {ClickUpApiClient} from '#api/client.js';
import {config} from '#config.js';
import {
  type ConnectClickUpInstallationInput,
  handleClickUpCallback,
  handleClickUpOAuthCallbackError,
} from '#core/install.js';
import {signClickUpInstallState} from '#core/state.js';
import type {ClickUpTokenStore} from '#core/tokens.js';
import type {ClickUpInstallationLock} from '#db/installations.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {clickUpRouteErrorHandler} from './errors.js';

export interface CreateClickUpIntegrationRoutesOptions {
  clickup: ClickUpApiClient;
  tokenStore: Pick<ClickUpTokenStore, 'storeTokens'>;
  getExistingClickUpConnection(input: {
    teamId: string;
  }): Promise<IntegrationConnection<'clickup'> | undefined>;
  connectClickUpInstallation(
    input: ConnectClickUpInstallationInput,
  ): Promise<IntegrationConnection<'clickup'>>;
  disconnectClickUpInstallation(input: {connectionId: string}): Promise<void>;
  withClickUpInstallationLock?: ClickUpInstallationLock;
  connectionCapabilities: IntegrationCapability[];
  requireActiveWorkspaceMembership?: (input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
  }) => Promise<unknown>;
}

export function createClickUpIntegrationRoutes(
  options: CreateClickUpIntegrationRoutesOptions,
): RouteGroup {
  const requireMembership =
    options.requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck;
  const installRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a ClickUp OAuth authorization URL for a workspace.',
    schema: {
      body: createClickUpInstallBodySchema,
      response: {200: createClickUpInstallResponseSchema},
    },
    handler: (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);
      requireWorkspaceAccess({request, workspaceId});
      const installUrl = new URL(`${config.CLICKUP_AUTH_BASE_URL}/api`);
      installUrl.searchParams.set('client_id', config.CLICKUP_OAUTH_CLIENT_ID);
      installUrl.searchParams.set('redirect_uri', config.CLICKUP_OAUTH_REDIRECT_URL);
      installUrl.searchParams.set(
        'state',
        signClickUpInstallState({workspaceId, userId: actor.userId}),
      );
      return {install_url: installUrl.toString()};
    },
  });
  const callbackApiRoute = defineRoute({
    method: 'GET',
    path: '/callback/api',
    auth: AUTH_USER,
    description: 'Handle the ClickUp OAuth callback.',
    schema: {
      querystring: clickupCallbackQuerySchema,
      response: {200: clickupCallbackResponseSchema},
    },
    errorHandler: clickUpRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const query = request.query;
      if (isClickUpOAuthErrorCallback(query)) {
        return await handleClickUpOAuthCallbackError({
          state: query.state,
          error: query.error,
          errorDescription: query.error_description,
          sessionUserId: actor.userId,
          sessionMemberships: actor.memberships,
          requireWorkspaceMembership: requireMembership,
        });
      }
      const connection = await handleClickUpCallback({
        ...options,
        code: query.code,
        state: query.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership: requireMembership,
      });
      return toIntegrationConnectionDto(connection, {capabilities: options.connectionCapabilities});
    },
  });
  return {prefix: '/integrations/clickup', routes: [installRoute, callbackApiRoute]};
}

function unavailableWorkspaceMembershipCheck(_input: {
  workspaceId: string;
  userId: string;
  memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
}): Promise<never> {
  return Promise.reject(new Error('Workspaces inter-module client is not configured'));
}

function isClickUpOAuthErrorCallback(
  query: ClickUpCallbackQueryDto,
): query is ClickUpCallbackQueryDto & {
  error: string;
  error_description?: string | undefined;
  state: string;
} {
  return 'error' in query && typeof query.error === 'string';
}
