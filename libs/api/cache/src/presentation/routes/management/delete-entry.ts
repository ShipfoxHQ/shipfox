import {cacheProjectEntryParamsSchema} from '@shipfox/api-cache-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {deleteCacheEntry} from '#core/delete-cache-entries.js';
import {requireProjectMember, translateManagementError} from '#presentation/management-access.js';

export function createDeleteEntryRoute(projects: Pick<ProjectsModuleClient, 'getProjectById'>) {
  return defineRoute({
    method: 'DELETE',
    path: '/entries/:entryId',
    description:
      'Delete one cache entry and its stored archive. Any member of the workspace may delete.',
    schema: {
      params: cacheProjectEntryParamsSchema,
      response: {204: z.void()},
    },
    errorHandler: translateManagementError,
    handler: async (request, reply) => {
      const {projectId, entryId} = request.params;
      await requireProjectMember({request, projectId, projects});

      await deleteCacheEntry({projectId, entryId});
      return reply.status(204).send();
    },
  });
}
