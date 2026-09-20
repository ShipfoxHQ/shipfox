import {
  createE2eNotionConnectionBodySchema,
  createE2eNotionConnectionResponseSchema,
} from '@shipfox/api-integration-notion-dto';
import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {logger} from '@shipfox/node-opentelemetry';
import type {ConnectNotionInstallationInput} from '#core/install.js';
import type {NotionTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface CreateE2eNotionConnectionRouteOptions {
  tokenStore: Pick<NotionTokenStore, 'storeTokens'>;
  getExistingNotionConnection: (input: {
    notionWorkspaceId: string;
  }) => Promise<IntegrationConnection<'notion'> | undefined>;
  connectNotionInstallation: (
    input: ConnectNotionInstallationInput,
  ) => Promise<IntegrationConnection<'notion'>>;
  disconnectNotionInstallation: (input: {connectionId: string}) => Promise<void>;
  connectionCapabilities: IntegrationCapability[];
}

export function createE2eNotionConnectionRoute(options: CreateE2eNotionConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/notion-connections',
    description: 'Create a synthetic Notion connection for E2E tests.',
    schema: {
      body: createE2eNotionConnectionBodySchema,
      response: {201: createE2eNotionConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const existing = await options.getExistingNotionConnection({
        notionWorkspaceId: body.notion_workspace_id,
      });
      if (existing && existing.workspaceId !== body.workspace_id) {
        throw new ClientError(
          'Notion workspace is already connected to another workspace',
          'notion-connection-workspace-mismatch',
          {status: 409},
        );
      }

      if (existing) {
        await options.tokenStore.storeTokens({
          connectionId: existing.id,
          accessToken: body.access_token,
        });
      }

      const connection = await options.connectNotionInstallation({
        workspaceId: body.workspace_id,
        notionWorkspaceId: body.notion_workspace_id,
        workspaceName: body.workspace_name,
        botId: body.bot_id,
        authorizedByUserId: body.authorized_by_user_id,
        tokenExpiresAt: body.token_expires_at ? new Date(body.token_expires_at) : null,
        lifecycleStatus: 'active',
        displayName: body.display_name,
      });

      if (!existing) {
        try {
          await options.tokenStore.storeTokens({
            connectionId: connection.id,
            accessToken: body.access_token,
          });
        } catch (error) {
          await bestEffortDisconnectNotionInstallation(options, connection.id);
          throw error;
        }
      }

      reply.code(201);
      return toIntegrationConnectionDto(connection, {capabilities: options.connectionCapabilities});
    },
  });
}

async function bestEffortDisconnectNotionInstallation(
  options: CreateE2eNotionConnectionRouteOptions,
  connectionId: string,
): Promise<void> {
  try {
    await options.disconnectNotionInstallation({connectionId});
  } catch (error) {
    logger().warn(
      {err: error, connectionId},
      'Notion E2E connection compensation failed after token storage rejection',
    );
  }
}
