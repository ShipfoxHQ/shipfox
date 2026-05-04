import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {
  createGithubInstallBodySchema,
  createGithubInstallResponseSchema,
  githubCallbackQuerySchema,
  githubCallbackResponseSchema,
} from '@shipfox/api-integration-github-dto';
import {requireMembership, requireWorkspaceMembership} from '@shipfox/api-workspaces';
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
}

export function createGithubIntegrationRoutes({
  github,
  getExistingGithubConnection,
  connectGithubInstallation,
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
    handler: async (request) => {
      const {workspace_id: workspaceId} = request.body;
      const actor = requireUserContext(request);

      await requireMembership({request, workspaceId});
      const state = signGithubInstallState({workspaceId, userId: actor.userId});
      const installUrl = new URL(
        `https://github.com/apps/${config.GITHUB_APP_SLUG}/installations/new`,
      );
      installUrl.searchParams.set('state', state);

      return {install_url: installUrl.toString()};
    },
  });

  const callbackPageRoute = defineRoute({
    method: 'GET',
    path: '/callback',
    description: 'Serve the GitHub App installation browser callback.',
    handler: (_request, reply) => {
      reply.type('text/html; charset=utf-8');
      return githubCallbackPageHtml();
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
        requireWorkspaceMembership,
        getExistingGithubConnection,
        connectGithubInstallation,
      });

      return toIntegrationConnectionDto(connection);
    },
  });

  return {
    prefix: '/integrations/github',
    routes: [createInstallRoute, callbackPageRoute, callbackApiRoute],
  };
}

function githubCallbackPageHtml(): string {
  const clientBaseUrl = JSON.stringify(config.CLIENT_BASE_URL);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connecting GitHub...</title>
  </head>
  <body>
    <script>
      const clientBaseUrl = ${clientBaseUrl};

      const redirect = (status, code, message) => {
        const url = new URL("/", clientBaseUrl);
        url.searchParams.set("integration_provider", "github");
        url.searchParams.set("integration_status", status);
        if (code) url.searchParams.set("integration_error_code", code);
        if (message) url.searchParams.set("integration_error_message", message);
        window.location.replace(url.toString());
      };

      const readError = async (response) => {
        try {
          return await response.json();
        } catch {
          return {};
        }
      };

      const connect = async () => {
        try {
          const sessionResponse = await fetch("/auth/refresh", {
            method: "POST",
            credentials: "include",
            headers: {"accept": "application/json"},
          });
          if (!sessionResponse.ok) {
            const error = await readError(sessionResponse);
            redirect("error", error.code, error.message);
            return;
          }

          const session = await sessionResponse.json();
          const callbackResponse = await fetch(
            "/integrations/github/callback/api" + window.location.search,
            {
              credentials: "include",
              headers: {
                "accept": "application/json",
                "authorization": "Bearer " + session.token,
              },
            },
          );
          if (callbackResponse.ok) {
            redirect("connected");
            return;
          }

          const error = await readError(callbackResponse);
          redirect("error", error.code, error.message);
        } catch {
          redirect("error", "github-callback-network-error", "Could not complete GitHub connection.");
        }
      };

      connect();
    </script>
  </body>
</html>`;
}
