import {
  createE2eSlackConnectionBodySchema,
  createE2eSlackConnectionResponseSchema,
} from '@shipfox/api-integration-slack-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {ConnectSlackInstallationInput} from '#core/install.js';
import type {SlackTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface CreateE2eSlackConnectionRouteOptions {
  tokenStore: Pick<SlackTokenStore, 'storeTokens'>;
  getExistingSlackConnection: (input: {
    teamId: string;
  }) => Promise<IntegrationConnection<'slack'> | undefined>;
  connectSlackInstallation: (
    input: ConnectSlackInstallationInput,
  ) => Promise<IntegrationConnection<'slack'>>;
  disconnectSlackInstallation: (input: {connectionId: string}) => Promise<void>;
  connectionCapabilities: IntegrationCapability[];
}

export function createE2eSlackConnectionRoute(options: CreateE2eSlackConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/slack-connections',
    description: 'Create a synthetic Slack connection for E2E tests.',
    schema: {
      body: createE2eSlackConnectionBodySchema,
      response: {201: createE2eSlackConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const existing = await options.getExistingSlackConnection({teamId: body.team_id});
      if (existing && existing.workspaceId !== body.workspace_id) {
        throw new ClientError(
          'Slack team is already connected to another workspace',
          'slack-connection-workspace-mismatch',
          {status: 409},
        );
      }
      const connection =
        existing ??
        (await options.connectSlackInstallation({
          workspaceId: body.workspace_id,
          teamId: body.team_id,
          teamName: body.team_name,
          appId: body.app_id,
          botUserId: body.bot_user_id,
          scopes: body.scopes,
          tokenExpiresAt: null,
          displayName: `Slack ${body.team_name}`,
        }));
      try {
        await options.tokenStore.storeTokens({
          connectionId: connection.id,
          botToken: body.bot_token,
        });
      } catch (error) {
        if (!existing) await bestEffortDisconnectSlackInstallation(options, connection.id);
        throw error;
      }
      reply.code(201);
      return toIntegrationConnectionDto(connection, {capabilities: options.connectionCapabilities});
    },
  });
}

async function bestEffortDisconnectSlackInstallation(
  options: CreateE2eSlackConnectionRouteOptions,
  connectionId: string,
): Promise<void> {
  try {
    await options.disconnectSlackInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'Slack E2E connection compensation failed after token storage rejection',
    );
  }
}
