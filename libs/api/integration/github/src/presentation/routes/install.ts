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
} from '@shipfox/api-integration-github-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {GithubApiClient} from '#api/client.js';
import {config} from '#config.js';
import type {ConnectGithubInstallationInput} from '#core/connection.js';
import {
  GithubInstallationAlreadyLinkedError,
  GithubLinkStateActorMismatchError,
  GithubLinkStateError,
  GithubMultipleLinkableInstallationsError,
  GithubNoLinkableInstallationError,
} from '#core/errors.js';
import {handleGithubCallback} from '#core/install.js';
import {handleGithubLinkCallback} from '#core/link.js';
import {
  createGithubLinkState,
  signGithubInstallState,
  verifyGithubInstallState,
  verifyGithubLinkState,
} from '#core/state.js';
import {recordGithubConnectOutcome} from '#metrics/index.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
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
        const connection = await handleGithubLinkCallback({
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
        recordGithubConnectOutcome({flow: 'link', outcome});
        logger().warn(
          {
            outcome,
            ...(stateClaims ? {workspaceId: stateClaims.workspaceId} : {}),
            ...githubLinkErrorContext(error),
          },
          'github link completed with an error',
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
          logger().error(outcomeContext, 'github install callback failed unexpectedly');
        }
        recordGithubConnectOutcome({flow: 'install', outcome: outcomeContext.outcome});
        throw error;
      }
    },
  });

  return {
    prefix: '/integrations/github',
    routes: [createInstallRoute, createLinkRoute, completeLinkRoute, callbackApiRoute],
  };
}

function githubConnectOutcome(
  error: unknown,
): 'no-linkable-installation' | 'multiple-linkable-installations' | 'already-linked' | 'error' {
  if (error instanceof GithubNoLinkableInstallationError) return 'no-linkable-installation';
  if (error instanceof GithubMultipleLinkableInstallationsError) {
    return 'multiple-linkable-installations';
  }
  if (error instanceof GithubInstallationAlreadyLinkedError) return 'already-linked';
  return 'error';
}

function githubLinkErrorContext(error: unknown): {
  errorCode?: string;
  installationId?: string;
} {
  if (error instanceof GithubNoLinkableInstallationError) {
    return {errorCode: 'github-no-linkable-installation'};
  }
  if (error instanceof GithubMultipleLinkableInstallationsError) {
    return {errorCode: 'github-multiple-linkable-installations'};
  }
  if (error instanceof GithubInstallationAlreadyLinkedError) {
    return {errorCode: 'github-installation-already-linked'};
  }
  if (error instanceof GithubLinkStateActorMismatchError) {
    return {errorCode: 'github-link-state-actor-mismatch'};
  }
  if (error instanceof GithubLinkStateError) {
    return {errorCode: 'invalid-github-link-state'};
  }
  return {};
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
