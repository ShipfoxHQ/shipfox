import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  createGithubInstallBodySchema,
  createGithubInstallResponseSchema,
  githubCallbackQuerySchema,
  githubCallbackResponseSchema,
} from '@shipfox/api-integration-github-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {GithubApiClient} from '#api/client.js';
import {config} from '#config.js';
import {type ConnectGithubInstallationInput, handleGithubCallback} from '#core/install.js';
import {signGithubInstallState} from '#core/state.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {githubRouteErrorHandler} from './errors.js';

export interface CreateGithubIntegrationRoutesOptions {
  github: GithubApiClient;
  getExistingGithubConnection: (input: {
    installationId: string;
  }) => Promise<IntegrationConnection<'github'> | undefined>;
  connectGithubInstallation: (
    input: ConnectGithubInstallationInput,
  ) => Promise<IntegrationConnection<'github'>>;
  requireActiveWorkspaceMembership?: (input: {
    workspaceId: string;
    userId: string;
    memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
  }) => Promise<unknown>;
}

export function createGithubIntegrationRoutes({
  github,
  getExistingGithubConnection,
  connectGithubInstallation,
  requireActiveWorkspaceMembership,
}: CreateGithubIntegrationRoutesOptions): RouteGroup {
  const createInstallRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a GitHub App installation URL for a workspace.',
    schema: {
      body: createGithubInstallBodySchema,
      response: {
        200: createGithubInstallResponseSchema,
      },
    },
    handler: (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);

      requireWorkspaceAccess({request, workspaceId});
      const state = signGithubInstallState({workspaceId, userId: actor.userId});
      const installUrl = new URL(
        `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`,
      );
      installUrl.searchParams.set('state', state);

      return {install_url: installUrl.toString()};
    },
  });

  const callbackApiRoute = defineRoute({
    method: 'GET',
    path: '/callback/api',
    auth: AUTH_USER,
    description: 'Handle the GitHub App installation callback.',
    schema: {
      querystring: githubCallbackQuerySchema,
      response: {
        200: githubCallbackResponseSchema,
      },
    },
    errorHandler: githubRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const connection = await handleGithubCallback({
        github,
        code: request.query.code,
        installationId: request.query.installation_id,
        state: request.query.state,
        sessionUserId: actor.userId,
        sessionMemberships: actor.memberships,
        requireWorkspaceMembership:
          requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck,
        getExistingGithubConnection,
        connectGithubInstallation,
      });

      return toIntegrationConnectionDto(connection);
    },
  });

  return {
    prefix: '/integrations/github',
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
