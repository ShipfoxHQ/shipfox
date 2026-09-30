import {randomUUID} from 'node:crypto';
import cookie from '@fastify/cookie';
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
import {DISCORD_INSTALL_STATE_TTL_SECONDS} from '#core/state.js';
import type {withDiscordGuildLock} from '#db/guild-lock.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {discordRouteErrorHandler} from './errors.js';

const DISCORD_ROUTES_PREFIX = '/integrations/discord';
const DISCORD_INSTALL_STATE_COOKIE = 'shipfox_discord_install_state';

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
    handler: (request, reply) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);
      requireWorkspaceAccess({request, workspaceId});
      const nonce = randomUUID();
      reply.setCookie(DISCORD_INSTALL_STATE_COOKIE, nonce, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: DISCORD_ROUTES_PREFIX,
        maxAge: DISCORD_INSTALL_STATE_TTL_SECONDS,
      });
      return {install_url: buildDiscordInstallUrl({workspaceId, userId: actor.userId, nonce})};
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
    handler: async (request, reply) => {
      const actor = requireUserContext(request);
      const query = request.query;
      const stateNonce = request.cookies[DISCORD_INSTALL_STATE_COOKIE];
      // The nonce is single-use: a failed or repeated callback needs a fresh install.
      reply.clearCookie(DISCORD_INSTALL_STATE_COOKIE, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: DISCORD_ROUTES_PREFIX,
      });
      if (isDiscordOAuthErrorCallback(query)) {
        return await handleDiscordOAuthCallbackError({
          state: query.state,
          stateNonce,
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
        stateNonce,
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

  return {
    prefix: DISCORD_ROUTES_PREFIX,
    plugins: [cookie],
    routes: [installRoute, callbackApiRoute],
  };
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
