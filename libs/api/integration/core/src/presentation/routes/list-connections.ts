import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  listIntegrationConnectionsQuerySchema,
  listIntegrationConnectionsResponseSchema,
} from '@shipfox/api-integration-spi';
import {defineRoute} from '@shipfox/node-fastify';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import {listIntegrationConnections} from '#db/connections.js';
import {toIntegrationConnectionDto} from '#presentation/dto/integrations.js';

export function createListIntegrationConnectionsRoute(registry: IntegrationProviderRegistry) {
  return defineRoute({
    method: 'GET',
    path: '/integration-connections',
    auth: AUTH_USER,
    description: 'List workspace integration connections across all lifecycle statuses.',
    schema: {
      querystring: listIntegrationConnectionsQuerySchema,
      response: {
        200: listIntegrationConnectionsResponseSchema,
      },
    },
    handler: async (request) => {
      const {workspace_id: workspaceId, capability} = request.query;

      requireWorkspaceAccess({request, workspaceId});
      const connections = await listIntegrationConnections({workspaceId});
      const providers = new Map(
        registry.list(capability).map((provider) => [provider.provider, provider]),
      );
      const connectionDtos = await Promise.all(
        connections.map(async (connection) => {
          const provider = providers.get(connection.provider);
          if (!provider) return undefined;
          // Best-effort: the external link is cosmetic, so a failing or missing
          // provider-side lookup must never fail the whole connections list.
          let externalUrl: string | undefined;
          try {
            externalUrl = await provider.connectionExternalUrl?.(connection);
          } catch (error) {
            request.log.warn(
              {connectionId: connection.id, provider: connection.provider, err: error},
              'Could not resolve integration connection external URL',
            );
          }
          return toIntegrationConnectionDto(connection, {
            capabilities: provider.capabilities,
            externalUrl,
          });
        }),
      );

      return {connections: connectionDtos.filter((connection) => connection !== undefined)};
    },
  });
}
