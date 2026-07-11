import type {IntegrationCapability, IntegrationConnection} from '@shipfox/api-integration-core-dto';
import {
  createE2eLinearConnectionBodySchema,
  createE2eLinearConnectionResponseSchema,
} from '@shipfox/api-integration-linear-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import type {ConnectLinearInstallationInput} from '#core/install.js';
import type {LinearTokenStore} from '#core/tokens.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export interface CreateE2eLinearConnectionRouteOptions {
  tokenStore: Pick<LinearTokenStore, 'storeTokens'>;
  getExistingLinearConnection: (input: {
    organizationId: string;
  }) => Promise<IntegrationConnection<'linear'> | undefined>;
  connectLinearInstallation: (
    input: ConnectLinearInstallationInput,
  ) => Promise<IntegrationConnection<'linear'>>;
  disconnectLinearInstallation: (input: {connectionId: string}) => Promise<void>;
  connectionCapabilities: IntegrationCapability[];
}

export function createE2eLinearConnectionRoute(options: CreateE2eLinearConnectionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/linear-connections',
    description: 'Create a synthetic Linear connection for E2E tests.',
    schema: {
      body: createE2eLinearConnectionBodySchema,
      response: {201: createE2eLinearConnectionResponseSchema},
    },
    handler: async (request, reply) => {
      const body = request.body;
      const existing = await options.getExistingLinearConnection({
        organizationId: body.organization_id,
      });
      if (existing && existing.workspaceId !== body.workspace_id) {
        throw new ClientError(
          'Linear organization is already connected to another workspace',
          'linear-connection-workspace-mismatch',
          {status: 409},
        );
      }
      const connection =
        existing ??
        (await options.connectLinearInstallation({
          workspaceId: body.workspace_id,
          organizationId: body.organization_id,
          organizationUrlKey: body.organization_url_key,
          appUserId: body.app_user_id,
          scopes: body.scopes,
          tokenExpiresAt: null,
          displayName: body.display_name,
        }));

      try {
        await options.tokenStore.storeTokens({
          connectionId: connection.id,
          accessToken: body.access_token,
        });
      } catch (error) {
        if (!existing) await options.disconnectLinearInstallation({connectionId: connection.id});
        throw error;
      }

      reply.code(201);
      return toIntegrationConnectionDto(connection, {capabilities: options.connectionCapabilities});
    },
  });
}
