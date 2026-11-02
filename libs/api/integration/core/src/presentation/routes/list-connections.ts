import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  listIntegrationConnectionsQuerySchema,
  listIntegrationConnectionsResponseSchema,
} from '@shipfox/api-integration-spi';
import {defineRoute} from '@shipfox/node-fastify';
import type {FastifyRequest} from 'fastify';
import type {IntegrationConnection} from '#core/entities/connection.js';
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
          // Best-effort: these details are cosmetic, so a failing provider-side
          // lookup must never fail the whole connections list.
          const lookup = <T>(message: string, fn: () => Promise<T> | undefined) =>
            bestEffort({request, connection, message, fn});
          const isActive = connection.lifecycleStatus === 'active';
          const [externalUrl, providerAccess, reconnectRequired] = await Promise.all([
            lookup('Could not resolve integration connection external URL', () =>
              provider.connectionExternalUrl?.(connection),
            ),
            // Only a connection that isn't active can have lost provider access.
            isActive
              ? undefined
              : lookup('Could not resolve integration connection provider access', () =>
                  provider.connectionProviderAccess?.(connection),
                ),
            // Only an active connection can need new permissions.
            isActive
              ? lookup('Could not resolve whether an integration connection must reconnect', () =>
                  provider.connectionReconnectRequired?.(connection),
                )
              : undefined,
          ]);
          return toIntegrationConnectionDto(connection, {
            capabilities: provider.capabilities,
            externalUrl,
            providerAccess,
            reconnectRequired,
          });
        }),
      );

      return {connections: connectionDtos.filter((connection) => connection !== undefined)};
    },
  });
}

async function bestEffort<T>(params: {
  request: FastifyRequest;
  connection: IntegrationConnection;
  message: string;
  fn: () => Promise<T> | undefined;
}): Promise<T | undefined> {
  try {
    return await params.fn();
  } catch (error) {
    params.request.log.warn(
      {connectionId: params.connection.id, provider: params.connection.provider, err: error},
      params.message,
    );
    return undefined;
  }
}
