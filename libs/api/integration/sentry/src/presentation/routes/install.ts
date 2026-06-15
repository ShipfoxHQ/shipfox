import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import type {IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {
  createSentryInstallBodySchema,
  createSentryInstallResponseSchema,
  sentryConnectBodySchema,
  sentryConnectResponseSchema,
} from '@shipfox/api-integration-sentry-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';
import type {SentryApiClient} from '#api/client.js';
import {config} from '#config.js';
import {type ConnectSentryInstallationInput, handleSentryConnect} from '#core/install.js';
import type {
  PersistVerifiedUnclaimedInstallationParams,
  SentryInstallation,
} from '#db/installations.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';
import {sentryRouteErrorHandler} from './errors.js';

export interface CreateSentryIntegrationRoutesOptions {
  sentry: SentryApiClient;
  getSentryInstallation: (input: {
    installationUuid: string;
  }) => Promise<SentryInstallation | undefined>;
  getConnectionById: (id: string) => Promise<IntegrationConnection<'sentry'> | undefined>;
  connectSentryInstallation: (
    input: ConnectSentryInstallationInput,
  ) => Promise<IntegrationConnection<'sentry'>>;
  persistVerifiedUnclaimedInstallation: (
    input: PersistVerifiedUnclaimedInstallationParams,
  ) => Promise<SentryInstallation>;
}

export function createSentryIntegrationRoutes({
  sentry,
  getSentryInstallation,
  getConnectionById,
  connectSentryInstallation,
  persistVerifiedUnclaimedInstallation,
}: CreateSentryIntegrationRoutesOptions): RouteGroup {
  const createInstallRoute = defineRoute({
    method: 'POST',
    path: '/install',
    auth: AUTH_USER,
    description: 'Create a Sentry app external-install URL for a workspace.',
    schema: {
      body: createSentryInstallBodySchema,
      response: {
        200: createSentryInstallResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspace_id: workspaceId} = request.body;

      await requireMembership({request, workspaceId});

      // Sentry has no state param to embed; the server owns the slug.
      const installUrl = `https://sentry.io/sentry-apps/${config.SENTRY_APP_SLUG}/external-install/`;
      return {install_url: installUrl};
    },
  });

  const connectRoute = defineRoute({
    method: 'POST',
    path: '/connect',
    auth: AUTH_USER,
    description: 'Link a Sentry installation to a workspace after the install redirect.',
    schema: {
      body: sentryConnectBodySchema,
      response: {
        200: sentryConnectResponseSchema,
      },
    },
    errorHandler: sentryRouteErrorHandler,
    handler: async (request) => {
      const {workspace_id: workspaceId, code, installation_id: installationUuid} = request.body;
      const actor = requireUserContext(request);

      await requireMembership({request, workspaceId});

      const connection = await handleSentryConnect({
        sentry,
        workspaceId,
        code,
        installationUuid,
        installerUserId: actor.userId,
        verifyInstall: config.SENTRY_APP_VERIFY_INSTALL,
        getSentryInstallation,
        getConnectionById,
        connectSentryInstallation,
        persistVerifiedUnclaimedInstallation,
      });

      return toIntegrationConnectionDto(connection);
    },
  });

  return {
    prefix: '/integrations/sentry',
    routes: [createInstallRoute, connectRoute],
  };
}
