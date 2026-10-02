import {
  createE2eSentryConnectionBodySchema,
  createE2eSentryConnectionResponseSchema,
} from '@shipfox/api-integration-sentry-dto';
import type {IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import type {ConnectSentryInstallationInput} from '#core/install.js';
import {type SentrySecretsStore, storeSentryAccessToken} from '#core/read-client.js';
import type {SentryInstallation} from '#db/installations.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

const E2E_ACCESS_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface CreateE2eSentryConnectionRouteOptions {
  secrets: Pick<SentrySecretsStore, 'setSecrets'>;
  getSentryInstallation: (input: {
    installationUuid: string;
  }) => Promise<SentryInstallation | undefined>;
  getConnectionById: (id: string) => Promise<IntegrationConnection<'sentry'> | undefined>;
  connectSentryInstallation: (
    input: ConnectSentryInstallationInput,
  ) => Promise<IntegrationConnection<'sentry'>>;
}

export function createE2eSentryConnectionRoute(options: CreateE2eSentryConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/sentry-connections',
    description: 'Create a synthetic Sentry connection for E2E tests.',
    schema: {
      body: createE2eSentryConnectionBodySchema,
      response: {201: createE2eSentryConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const installation = await options.getSentryInstallation({
        installationUuid: body.installation_uuid,
      });
      const existing = installation?.connectionId
        ? await options.getConnectionById(installation.connectionId)
        : undefined;
      if (existing && existing.workspaceId !== body.workspace_id) {
        throw new ClientError(
          'Sentry installation is already connected to another workspace',
          'sentry-connection-workspace-mismatch',
          {status: 409},
        );
      }

      const connection =
        existing ??
        (await options.connectSentryInstallation({
          workspaceId: body.workspace_id,
          installationUuid: body.installation_uuid,
          orgSlug: body.org_slug,
          displayName: body.display_name,
        }));

      await storeSentryAccessToken({
        secrets: options.secrets,
        workspaceId: connection.workspaceId,
        connectionId: connection.id,
        token: body.access_token,
        expiresAt: new Date(Date.now() + E2E_ACCESS_TOKEN_TTL_MS).toISOString(),
      });

      reply.code(201);
      return toIntegrationConnectionDto(connection);
    },
  });
}
