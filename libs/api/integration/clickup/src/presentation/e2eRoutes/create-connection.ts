import {
  createE2eClickUpConnectionBodySchema,
  createE2eClickUpConnectionResponseSchema,
} from '@shipfox/api-integration-clickup-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {ConnectClickUpInstallationInput} from '#core/install.js';
import type {ClickUpTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface CreateE2eClickUpConnectionRouteOptions {
  tokenStore: Pick<ClickUpTokenStore, 'storeTokens'>;
  getExistingClickUpConnection: (input: {
    teamId: string;
  }) => Promise<IntegrationConnection<'clickup'> | undefined>;
  connectClickUpInstallation: (
    input: ConnectClickUpInstallationInput,
  ) => Promise<IntegrationConnection<'clickup'>>;
  disconnectClickUpInstallation: (input: {connectionId: string}) => Promise<void>;
  connectionCapabilities: IntegrationCapability[];
}

export function createE2eClickUpConnectionRoute(options: CreateE2eClickUpConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/clickup-connections',
    description: 'Create a synthetic ClickUp connection for E2E tests.',
    schema: {
      body: createE2eClickUpConnectionBodySchema,
      response: {201: createE2eClickUpConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const workspaceId = body.workspace_id.toLowerCase();
      const existing = await options.getExistingClickUpConnection({teamId: body.team_id});
      if (existing && existing.workspaceId !== workspaceId) {
        throw new ClientError(
          'ClickUp workspace is already connected to another workspace',
          'clickup-connection-workspace-mismatch',
          {status: 409},
        );
      }

      if (existing) {
        await options.tokenStore.storeTokens({
          connectionId: existing.id,
          accessToken: body.access_token,
          webhookSecret: body.webhook_secret,
        });
      }

      const connection = await options.connectClickUpInstallation({
        workspaceId,
        teamId: body.team_id,
        teamName: body.team_name,
        authorizingUserId: body.authorizing_user_id,
        webhookId: body.webhook_id,
        displayName: body.display_name,
      });

      if (!existing) {
        try {
          await options.tokenStore.storeTokens({
            connectionId: connection.id,
            accessToken: body.access_token,
            webhookSecret: body.webhook_secret,
          });
        } catch (error) {
          await bestEffortDisconnectClickUpInstallation(options, connection.id);
          throw error;
        }
      }

      reply.code(201);
      return toIntegrationConnectionDto(connection, {capabilities: options.connectionCapabilities});
    },
  });
}

async function bestEffortDisconnectClickUpInstallation(
  options: CreateE2eClickUpConnectionRouteOptions,
  connectionId: string,
): Promise<void> {
  try {
    await options.disconnectClickUpInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'ClickUp E2E connection compensation failed after token storage rejection',
    );
  }
}
