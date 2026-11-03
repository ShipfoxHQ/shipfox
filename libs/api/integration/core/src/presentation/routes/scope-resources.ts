import {AUTH_USER, requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {
  listScopeResourcesParamsSchema,
  listScopeResourcesQuerySchema,
  listScopeResourcesResponseSchema,
} from '@shipfox/api-integration-spi';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import type {IntegrationProviderRegistry} from '#core/providers/registry.js';
import type {IntegrationSourceControlService} from '#core/source-control-service.js';
import {integrationRouteErrorHandler} from './errors.js';

export function createListScopeResourcesRoute(params: {
  registry: IntegrationProviderRegistry;
  sourceControl: IntegrationSourceControlService;
}) {
  return defineRoute({
    method: 'GET',
    path: '/integration-connections/:connectionId/scope-resources',
    auth: AUTH_USER,
    description:
      'List the resources of one kind that a project can be limited to on an integration connection.',
    schema: {
      params: listScopeResourcesParamsSchema,
      querystring: listScopeResourcesQuerySchema,
      response: {
        200: listScopeResourcesResponseSchema,
      },
    },
    errorHandler: integrationRouteErrorHandler,
    handler: async (request) => {
      const connection = await params.sourceControl.getConnection(request.params.connectionId);
      const access = requireWorkspaceAccess({request, workspaceId: connection.workspaceId});
      if (access.role !== 'admin') {
        throw new ClientError('Workspace admin role required', 'forbidden', {status: 403});
      }

      const provider = params.registry.find(connection.provider);
      const {kind} = request.query;
      if (
        provider?.internal ||
        !provider?.listScopeResources ||
        !provider.resourceKinds?.some((declared) => declared.kind === kind)
      ) {
        throw new ClientError(
          'This integration provider does not support limiting access to this resource kind',
          'integration-resource-kind-unsupported',
          {status: 422},
        );
      }

      const page = await provider.listScopeResources({
        connection,
        kind,
        limit: request.query.limit,
        cursor: request.query.cursor,
        query: request.query.search,
      });

      return {
        resources: page.resources.map((resource) => ({
          kind: resource.kind,
          external_id: resource.externalId,
          lookup_name: resource.lookupName,
          display_name: resource.displayName,
        })),
        next_cursor: page.nextCursor,
      };
    },
  });
}
