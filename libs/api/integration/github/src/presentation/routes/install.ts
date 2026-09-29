import {AUTH_USER, requireUserContext, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  completeGithubLinkBodySchema,
  completeGithubLinkResponseSchema,
  createGithubInstallBodySchema,
  createGithubInstallResponseSchema,
  createGithubLinkBodySchema,
  createGithubLinkResponseSchema,
  githubCallbackQuerySchema,
  githubCallbackResponseSchema,
  selectGithubLinkBodySchema,
  selectGithubLinkResponseSchema,
} from '@shipfox/api-integration-github-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {GithubApiClient} from '#api/client.js';
import {config} from '#config.js';
import type {ConnectGithubInstallationInput} from '#core/connection.js';
import {
  GithubInstallationAlreadyLinkedError,
  GithubInstallationSuspendedError,
  GithubNoLinkableInstallationError,
  GithubTooManyLinkableInstallationsError,
} from '#core/errors.js';
import {handleGithubCallback} from '#core/install.js';
import {handleGithubLinkCallback, handleGithubLinkSelection} from '#core/link.js';
import {
  createGithubLinkState,
  signGithubInstallState,
  verifyGithubInstallState,
  verifyGithubLinkSelection,
  verifyGithubLinkState,
} from '#core/state.js';
import {type GithubConnectOutcome, recordGithubConnectOutcome} from '#metrics/index.js';
import {
  toGithubLinkSelectionDto,
  toIntegrationConnectionDto,
} from '#presentation/dto/integrations.js';
import {githubRouteErrorCode, githubRouteErrorHandler} from './errors.js';

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
      logger().info({workspaceId, flow: 'install'}, 'github install flow started');
      const state = signGithubInstallState({workspaceId, userId: actor.userId});
      const installUrl = new URL(
        `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`,
      );
      installUrl.searchParams.set('state', state);

      return {install_url: installUrl.toString()};
    },
  });

  const createLinkRoute = defineRoute({
    method: 'POST',
    path: '/link',
    auth: AUTH_USER,
    description: 'Create a fresh GitHub user OAuth URL for an existing installation.',
    schema: {
      body: createGithubLinkBodySchema,
      response: {
        200: createGithubLinkResponseSchema,
      },
    },
    handler: (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);

      requireWorkspaceAccess({request, workspaceId});
      const linkState = createGithubLinkState({workspaceId, userId: actor.userId});
      const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
      authorizeUrl.searchParams.set('client_id', config.GITHUB_APP_CLIENT_ID);
      authorizeUrl.searchParams.set('state', linkState.state);
      authorizeUrl.searchParams.set('code_challenge', linkState.codeChallenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      logger().info({workspaceId, flow: 'link'}, 'github link started');

      return {authorize_url: authorizeUrl.toString()};
    },
  });

  const completeLinkRoute = defineRoute({
    method: 'POST',
    path: '/link/complete',
    auth: AUTH_USER,
    description: 'Complete fresh GitHub user OAuth and connect an existing installation.',
    schema: {
      body: completeGithubLinkBodySchema,
      response: {
        200: completeGithubLinkResponseSchema,
      },
    },
    errorHandler: githubRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      let stateClaims: ReturnType<typeof verifyGithubLinkState> | undefined;
      try {
        stateClaims = verifyGithubLinkState(request.body.state);
        const result = await handleGithubLinkCallback({
          github,
          code: request.body.code,
          state: request.body.state,
          sessionUserId: actor.userId,
          sessionMemberships: actor.memberships,
          requireWorkspaceMembership:
            requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck,
          getExistingGithubConnection,
          connectGithubInstallation,
        });
        if ('selectionToken' in result) {
          recordGithubConnectOutcome({flow: 'link', outcome: 'selection-required'});
          logger().info(
            {
              outcome: 'selection-required',
              workspaceId: stateClaims.workspaceId,
              candidates: result.candidates.length,
            },
            'github link completed',
          );
          return toGithubLinkSelectionDto(result);
        }
        const connection = result;
        recordGithubConnectOutcome({flow: 'link', outcome: 'success'});
        logger().info(
          {
            outcome: 'success',
            workspaceId: connection.workspaceId,
            installationId: connection.externalAccountId,
          },
          'github link completed',
        );
        return toIntegrationConnectionDto(connection);
      } catch (error) {
        const outcome = githubConnectOutcome(error);
        const errorCode = githubRouteErrorCode(error);
        recordGithubConnectOutcome({flow: 'link', outcome});
        logger().warn(
          {
            outcome,
            ...(stateClaims ? {workspaceId: stateClaims.workspaceId} : {}),
            ...(errorCode ? {errorCode} : {}),
          },
          'github link completed with an error',
        );
        throw error;
      }
    },
  });

  const selectLinkRoute = defineRoute({
    method: 'POST',
    path: '/link/select',
    auth: AUTH_USER,
    description: 'Connect one installation offered by a GitHub link selection token.',
    schema: {
      body: selectGithubLinkBodySchema,
      response: {
        200: selectGithubLinkResponseSchema,
      },
    },
    errorHandler: githubRouteErrorHandler,
    handler: async (request) => {
      const actor = requireUserContext(request);
      const installationId = String(request.body.installation_id);
      let workspaceId: string | undefined;
      try {
        workspaceId = verifyGithubLinkSelection(request.body.selection_token).workspaceId;
        const connection = await handleGithubLinkSelection({
          github,
          selectionToken: request.body.selection_token,
          installationId: request.body.installation_id,
          sessionUserId: actor.userId,
          sessionMemberships: actor.memberships,
          requireWorkspaceMembership:
            requireActiveWorkspaceMembership ?? unavailableWorkspaceMembershipCheck,
          getExistingGithubConnection,
          connectGithubInstallation,
        });
        recordGithubConnectOutcome({flow: 'link', outcome: 'success'});
        logger().info(
          {outcome: 'success', workspaceId: connection.workspaceId, installationId},
          'github link selection completed',
        );
        return toIntegrationConnectionDto(connection);
      } catch (error) {
        const outcome = githubConnectOutcome(error);
        const errorCode = githubRouteErrorCode(error);
        recordGithubConnectOutcome({flow: 'link', outcome});
        logger().warn(
          {
            outcome,
            installationId,
            ...(workspaceId ? {workspaceId} : {}),
            ...(errorCode ? {errorCode} : {}),
          },
          'github link selection completed with an error',
        );
        throw error;
      }
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
      const callbackContext = {
        workspaceId: workspaceIdFromInstallState(request.query.state),
        installationId: request.query.installation_id,
        ...(request.query.setup_action ? {setupAction: request.query.setup_action} : {}),
      };

      try {
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

        const outcomeContext = {
          ...callbackContext,
          outcome: 'success' as const,
          workspaceId: connection.workspaceId,
        };
        logger().info(outcomeContext, 'github install callback completed');
        recordGithubConnectOutcome({flow: 'install', outcome: 'success'});
        return toIntegrationConnectionDto(connection);
      } catch (error) {
        const errorCode = githubRouteErrorCode(error);
        const outcomeContext = {
          ...callbackContext,
          outcome: githubConnectOutcome(error),
          ...(errorCode ? {errorCode} : {}),
        };
        if (errorCode) {
          logger().warn(outcomeContext, 'github install callback failed');
        } else {
          logger().error(
            {...outcomeContext, err: error},
            'github install callback failed unexpectedly',
          );
        }
        recordGithubConnectOutcome({flow: 'install', outcome: outcomeContext.outcome});
        throw error;
      }
    },
  });

  return {
    prefix: '/integrations/github',
    routes: [
      createInstallRoute,
      createLinkRoute,
      completeLinkRoute,
      selectLinkRoute,
      callbackApiRoute,
    ],
  };
}

function githubConnectOutcome(error: unknown): GithubConnectOutcome {
  if (error instanceof GithubNoLinkableInstallationError) return 'no-linkable-installation';
  if (error instanceof GithubTooManyLinkableInstallationsError) {
    return 'too-many-linkable-installations';
  }
  if (error instanceof GithubInstallationSuspendedError) return 'installation-suspended';
  if (error instanceof GithubInstallationAlreadyLinkedError) return 'already-linked';
  return 'error';
}

function workspaceIdFromInstallState(state: string): string | undefined {
  try {
    return verifyGithubInstallState(state).workspaceId;
  } catch {
    return undefined;
  }
}

function unavailableWorkspaceMembershipCheck(_input: {
  workspaceId: string;
  userId: string;
  memberships: ReadonlyArray<import('@shipfox/api-auth-context').UserContextMembership>;
}): Promise<never> {
  return Promise.reject(new Error('Workspaces inter-module client is not configured'));
}
