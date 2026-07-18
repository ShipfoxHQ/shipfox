import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {
  createSlackInstallBodySchema,
  createSlackInstallResponseSchema,
  type SlackCallbackQueryDto,
  slackCallbackQuerySchema,
  slackCallbackResponseSchema,
} from '@shipfox/api-integration-slack-dto';
import {requireWorkspaceMembership} from '@shipfox/api-workspaces';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {SlackApiClient} from '#api/client.js';
import {config} from '#config.js';
import {
  type ConnectSlackInstallationInput,
  handleSlackCallback,
  handleSlackOAuthCallbackError,
} from '#core/install.js';
import {formatSlackBotScopes} from '#core/scopes.js';
import {signSlackInstallState} from '#core/state.js';
import type {SlackTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {slackRouteErrorHandler} from './errors.js';

export interface CreateSlackIntegrationRoutesOptions {
  slack: SlackApiClient;
  tokenStore: Pick<SlackTokenStore, 'storeTokens'>;
  getExistingSlackConnection: (input: {
    teamId: string;
  }) => Promise<IntegrationConnection<'slack'> | undefined>;
  connectSlackInstallation: (
    input: ConnectSlackInstallationInput,
  ) => Promise<IntegrationConnection<'slack'>>;
  disconnectSlackInstallation: (input: {connectionId: string}) => Promise<void>;
  connectionCapabilities: IntegrationCapability[];
}

export function createSlackIntegrationRoutes({
  slack,
  tokenStore,
  getExistingSlackConnection,
  connectSlackInstallation,
  disconnectSlackInstallation,
  connectionCapabilities,
}: CreateSlackIntegrationRoutesOptions): RouteGroup {
  const installRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a Slack OAuth authorization URL for a workspace.',
    schema: {
      body: createSlackInstallBodySchema,
      response: {200: createSlackInstallResponseSchema},
    },
    handler: (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);
      requireWorkspaceAccess({request, workspaceId});
      const state = signSlackInstallState({workspaceId, userId: actor.userId});
      const installUrl = new URL('https://slack.com/oauth/v2/authorize');
      installUrl.searchParams.set('client_id', config.SLACK_OAUTH_CLIENT_ID);
      installUrl.searchParams.set('scope', formatSlackBotScopes());
      installUrl.searchParams.set('redirect_uri', config.SLACK_OAUTH_REDIRECT_URL);
      installUrl.searchParams.set('state', state);
      return {install_url: installUrl.toString()};
    },
  });

  const callbackApiRoute = defineRoute({
    method: 'GET',
    path: '/callback/api',
    auth: AUTH_USER,
    description: 'Handle the Slack OAuth callback.',
    schema: {
      querystring: slackCallbackQuerySchema,
      response: {200: slackCallbackResponseSchema},
    },
    errorHandler: slackRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const query = request.query;
      if (isSlackOAuthErrorCallback(query)) {
        return await handleSlackOAuthCallbackError({
          state: query.state,
          error: query.error,
          errorDescription: query.error_description,
          sessionUserId: actor.userId,
          sessionMemberships: actor.memberships,
          requireWorkspaceMembership,
        });
      }
      const connection = await handleSlackCallback({
        slack,
        tokenStore,
        code: query.code,
        state: query.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership,
        getExistingSlackConnection,
        connectSlackInstallation,
        disconnectSlackInstallation,
      });
      return toIntegrationConnectionDto(connection, {capabilities: connectionCapabilities});
    },
  });

  return {prefix: '/integrations/slack', routes: [installRoute, callbackApiRoute]};
}

function isSlackOAuthErrorCallback(query: SlackCallbackQueryDto): query is SlackCallbackQueryDto & {
  error: string;
  error_description?: string | undefined;
  state: string;
} {
  return 'error' in query && typeof query.error === 'string';
}
