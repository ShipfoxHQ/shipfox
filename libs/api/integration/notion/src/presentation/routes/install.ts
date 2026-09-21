import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  createNotionInstallBodySchema,
  createNotionInstallResponseSchema,
  type NotionCallbackQueryDto,
  notionCallbackQuerySchema,
  notionCallbackResponseSchema,
} from '@shipfox/api-integration-notion-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {NotionApiClient} from '#api/client.js';
import {config} from '#config.js';
import {
  type ConnectNotionInstallationInput,
  handleNotionCallback,
  handleNotionOAuthCallbackError,
} from '#core/install.js';
import {signNotionInstallState} from '#core/state.js';
import type {NotionTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {notionRouteErrorHandler} from './errors.js';

export interface CreateNotionIntegrationRoutesOptions {
  notion: NotionApiClient;
  tokenStore: Pick<NotionTokenStore, 'storeTokens' | 'getTokens'>;
  getExistingNotionConnection(input: {
    notionWorkspaceId: string;
  }): Promise<IntegrationConnection<'notion'> | undefined>;
  getNotionInstallationByConnectionId: typeof import('#db/installations.js').getNotionInstallationByConnectionId;
  connectNotionInstallation(
    input: ConnectNotionInstallationInput,
  ): Promise<IntegrationConnection<'notion'>>;
  restoreNotionInstallation: typeof import('#db/installations.js').restoreNotionInstallation;
  disconnectNotionInstallation(input: {connectionId: string}): Promise<void>;
  connectionCapabilities: IntegrationCapability[];
  requireActiveWorkspaceMembership?: (input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
  }) => Promise<unknown>;
}

export function createNotionIntegrationRoutes(
  options: CreateNotionIntegrationRoutesOptions,
): RouteGroup {
  const requireMembership =
    options.requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck;
  const installRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a Notion OAuth authorization URL for a workspace.',
    schema: {
      body: createNotionInstallBodySchema,
      response: {200: createNotionInstallResponseSchema},
    },
    handler: (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);
      requireWorkspaceAccess({request, workspaceId});
      const state = signNotionInstallState({workspaceId, userId: actor.userId});
      const installUrl = new URL('https://api.notion.com/v1/oauth/authorize');
      installUrl.searchParams.set('client_id', config.NOTION_OAUTH_CLIENT_ID);
      installUrl.searchParams.set('response_type', 'code');
      installUrl.searchParams.set('owner', 'user');
      installUrl.searchParams.set('redirect_uri', config.NOTION_OAUTH_REDIRECT_URL);
      installUrl.searchParams.set('state', state);
      return {install_url: installUrl.toString()};
    },
  });

  const callbackApiRoute = defineRoute({
    method: 'GET',
    path: '/callback/api',
    auth: AUTH_USER,
    description: 'Handle the Notion OAuth callback.',
    schema: {
      querystring: notionCallbackQuerySchema,
      response: {200: notionCallbackResponseSchema},
    },
    errorHandler: notionRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const query = request.query;
      if (isNotionOAuthErrorCallback(query)) {
        return await handleNotionOAuthCallbackError({
          state: query.state,
          error: query.error,
          errorDescription: query.error_description,
          sessionUserId: actor.userId,
          sessionMemberships: actor.memberships,
          requireWorkspaceMembership: requireMembership,
        });
      }
      const result = await handleNotionCallback({
        notion: options.notion,
        tokenStore: options.tokenStore,
        code: query.code,
        state: query.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership: requireMembership,
        getExistingNotionConnection: options.getExistingNotionConnection,
        getNotionInstallationByConnectionId: options.getNotionInstallationByConnectionId,
        connectNotionInstallation: options.connectNotionInstallation,
        restoreNotionInstallation: options.restoreNotionInstallation,
        disconnectNotionInstallation: options.disconnectNotionInstallation,
      });
      return {
        outcome: result.reconnected ? ('reconnected' as const) : ('connected' as const),
        connection: toIntegrationConnectionDto(result.connection, {
          capabilities: options.connectionCapabilities,
        }),
      };
    },
  });

  return {prefix: '/integrations/notion', routes: [installRoute, callbackApiRoute]};
}

function unavailableWorkspaceMembershipCheck(_input: {
  workspaceId: string;
  userId: string;
  memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
}): Promise<never> {
  return Promise.reject(new Error('Workspaces inter-module client is not configured'));
}

function isNotionOAuthErrorCallback(
  query: NotionCallbackQueryDto,
): query is NotionCallbackQueryDto & {
  error: string;
  error_description?: string | undefined;
  state: string;
} {
  return 'error' in query && typeof query.error === 'string';
}
