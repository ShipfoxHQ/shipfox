import {
  AUTH_USER,
  requireUserContext,
  requireWorkspaceAccess,
  type UserContextMembership,
} from '@shipfox/api-auth-context';
import {
  createDiscordInstallBodySchema,
  createDiscordInstallResponseSchema,
  type DiscordCallbackQueryDto,
  discordCallbackQuerySchema,
  discordCallbackResponseSchema,
} from '@shipfox/api-integration-discord-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {DiscordApiClient} from '#api/client.js';
import {
  buildDiscordInstallUrl,
  type ConnectDiscordInstallationInput,
  handleDiscordCallback,
  handleDiscordOAuthCallbackError,
} from '#core/install.js';
import type {withDiscordGuildLock} from '#db/guild-lock.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {discordRouteErrorHandler} from './errors.js';

export interface CreateDiscordInstallRoutesOptions {
  discord: Pick<DiscordApiClient, 'exchangeAuthorizationCode' | 'revokeAccessToken' | 'getGuild'>;
  getExistingDiscordConnection(input: {
    guildId: string;
  }): Promise<IntegrationConnection<'discord'> | undefined>;
  connectDiscordInstallation(
    input: ConnectDiscordInstallationInput,
  ): Promise<IntegrationConnection<'discord'>>;
  connectionCapabilities: IntegrationCapability[];
  requireActiveWorkspaceMembership?: (input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<UserContextMembership>;
  }) => Promise<unknown>;
  withGuildLock?: typeof withDiscordGuildLock | undefined;
}

export function createDiscordInstallRoutes(options: CreateDiscordInstallRoutesOptions): RouteGroup {
  const requireMembership =
    options.requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck;

  const installRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a Discord OAuth authorization URL for a workspace.',
    schema: {
      body: createDiscordInstallBodySchema,
      response: {200: createDiscordInstallResponseSchema},
    },
    handler: (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);
      requireWorkspaceAccess({request, workspaceId});
      return {install_url: buildDiscordInstallUrl({workspaceId, userId: actor.userId})};
    },
  });

  const callbackApiRoute = defineRoute({
    method: 'GET',
    path: '/callback/api',
    auth: AUTH_USER,
    description: 'Handle the Discord OAuth callback.',
    schema: {
      querystring: discordCallbackQuerySchema,
      response: {200: discordCallbackResponseSchema},
    },
    errorHandler: discordRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const query = request.query;
      if (isDiscordOAuthErrorCallback(query)) {
        return await handleDiscordOAuthCallbackError({
          state: query.state,
          error: query.error,
          errorDescription: query.error_description,
          sessionUserId: actor.userId,
          sessionMemberships: actor.memberships,
          requireWorkspaceMembership: requireMembership,
        });
      }
      const result = await handleDiscordCallback({
        discord: options.discord,
        code: query.code,
        state: query.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership: requireMembership,
        getExistingDiscordConnection: options.getExistingDiscordConnection,
        connectDiscordInstallation: options.connectDiscordInstallation,
        withGuildLock: options.withGuildLock,
      });
      return {
        outcome: result.outcome,
        connection: toIntegrationConnectionDto(result.connection, {
          capabilities: options.connectionCapabilities,
        }),
      };
    },
  });

  return {prefix: '/integrations/discord', routes: [installRoute, callbackApiRoute]};
}

function unavailableWorkspaceMembershipCheck(_input: {
  workspaceId: string;
  userId: string;
  memberships: ReadonlyArray<UserContextMembership>;
}): Promise<never> {
  return Promise.reject(new Error('Workspaces inter-module client is not configured'));
}

function isDiscordOAuthErrorCallback(
  query: DiscordCallbackQueryDto,
): query is Extract<DiscordCallbackQueryDto, {error: string}> {
  return 'error' in query && typeof query.error === 'string';
}
