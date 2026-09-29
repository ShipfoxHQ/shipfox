import {
  createE2eJiraConnectionBodySchema,
  createE2eJiraConnectionResponseSchema,
} from '@shipfox/api-integration-jira-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {ConnectJiraInstallationInput} from '#core/install.js';
import type {JiraTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface CreateE2eJiraConnectionRouteOptions {
  tokenStore: Pick<JiraTokenStore, 'storeTokens'>;
  getExistingJiraConnection: (input: {
    cloudId: string;
  }) => Promise<IntegrationConnection<'jira'> | undefined>;
  connectJiraInstallation: (
    input: ConnectJiraInstallationInput,
  ) => Promise<IntegrationConnection<'jira'>>;
  disconnectJiraInstallation: (input: {connectionId: string}) => Promise<void>;
  connectionCapabilities: IntegrationCapability[];
}

export function createE2eJiraConnectionRoute(options: CreateE2eJiraConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/jira-connections',
    description: 'Create a synthetic Jira connection for E2E tests.',
    schema: {
      body: createE2eJiraConnectionBodySchema,
      response: {201: createE2eJiraConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const existing = await options.getExistingJiraConnection({cloudId: body.cloud_id});
      if (existing && existing.workspaceId !== body.workspace_id) {
        throw new ClientError(
          'Jira site is already connected to another workspace',
          'jira-connection-workspace-mismatch',
          {status: 409},
        );
      }

      const connection =
        existing ??
        (await options.connectJiraInstallation({
          workspaceId: body.workspace_id,
          cloudId: body.cloud_id,
          siteUrl: body.site_url,
          siteName: body.site_name,
          authorizingAccountId: body.authorizing_account_id,
          scopes: body.scopes,
          tokenExpiresAt: null,
          displayName: body.display_name,
        }));

      try {
        await options.tokenStore.storeTokens({
          connectionId: connection.id,
          accessToken: body.access_token,
          ...(body.refresh_token === undefined ? {} : {refreshToken: body.refresh_token}),
        });
      } catch (error) {
        if (!existing) await bestEffortDisconnectJiraInstallation(options, connection.id);
        throw error;
      }

      reply.code(201);
      return toIntegrationConnectionDto(connection, {capabilities: options.connectionCapabilities});
    },
  });
}

async function bestEffortDisconnectJiraInstallation(
  options: CreateE2eJiraConnectionRouteOptions,
  connectionId: string,
): Promise<void> {
  try {
    await options.disconnectJiraInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'Jira E2E connection compensation failed after token storage rejection',
    );
  }
}
