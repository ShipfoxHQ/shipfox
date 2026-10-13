import {
  cacheProjectScopeParamsSchema,
  deleteCacheScopeResponseSchema,
} from '@shipfox/api-cache-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {deleteCacheScope} from '#core/delete-cache-entries.js';
import {toDeleteCacheScopeDto} from '#presentation/dto/management.js';
import {requireProjectMember} from '#presentation/management-access.js';

export function createDeleteScopeRoute(projects: Pick<ProjectsModuleClient, 'getProjectById'>) {
  return defineRoute({
    method: 'DELETE',
    path: '/scopes/*',
    description:
      'Delete every cache entry of a scope and its stored archives. Pass the stored scope as listed after /scopes/: a dev sandbox reads dev/{user_id}/{scope}. Any member of the workspace may delete.',
    schema: {
      params: cacheProjectScopeParamsSchema,
      response: {200: deleteCacheScopeResponseSchema},
    },
    handler: async (request) => {
      const {projectId, '*': scope} = request.params;
      await requireProjectMember({request, projectId, projects});

      return toDeleteCacheScopeDto(await deleteCacheScope({projectId, scope}));
    },
  });
}
