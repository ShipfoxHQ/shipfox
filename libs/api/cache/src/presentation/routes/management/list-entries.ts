import {
  cacheProjectParamsSchema,
  listCacheEntriesQuerySchema,
  listCacheEntriesResponseSchema,
} from '@shipfox/api-cache-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {listCacheEntries} from '#core/list-cache-entries.js';
import {toCacheEntrySummaryDto} from '#presentation/dto/management.js';
import {requireProjectMember, translateManagementError} from '#presentation/management-access.js';

export function createListEntriesRoute(projects: Pick<ProjectsModuleClient, 'getProjectById'>) {
  return defineRoute({
    method: 'GET',
    path: '/entries',
    description:
      'List the committed cache entries of a project, newest first. Filter by stored scope and key prefix.',
    schema: {
      params: cacheProjectParamsSchema,
      querystring: listCacheEntriesQuerySchema,
      response: {200: listCacheEntriesResponseSchema},
    },
    errorHandler: translateManagementError,
    handler: async (request) => {
      const {projectId} = request.params;
      const {scope, key_prefix: keyPrefix, cursor, limit} = request.query;
      await requireProjectMember({request, projectId, projects});

      const page = await listCacheEntries({projectId, scope, keyPrefix, cursor, limit});
      return {entries: page.entries.map(toCacheEntrySummaryDto), next_cursor: page.nextCursor};
    },
  });
}
