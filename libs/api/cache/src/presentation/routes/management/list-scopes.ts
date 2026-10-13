import {cacheProjectParamsSchema, listCacheScopesResponseSchema} from '@shipfox/api-cache-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {listCacheScopes} from '#core/list-cache-scopes.js';
import {toCacheScopeSummaryDto} from '#presentation/dto/management.js';
import {requireProjectMember} from '#presentation/management-access.js';

export function createListScopesRoute(projects: Pick<ProjectsModuleClient, 'getProjectById'>) {
  return defineRoute({
    method: 'GET',
    path: '/scopes',
    description:
      'List the scopes of a project that hold cache entries, with entry count, size, and last use. Dev sandboxes are listed with the user they belong to.',
    schema: {
      params: cacheProjectParamsSchema,
      response: {200: listCacheScopesResponseSchema},
    },
    handler: async (request) => {
      const {projectId} = request.params;
      await requireProjectMember({request, projectId, projects});

      const scopes = await listCacheScopes(projectId);
      return {scopes: scopes.map(toCacheScopeSummaryDto)};
    },
  });
}
