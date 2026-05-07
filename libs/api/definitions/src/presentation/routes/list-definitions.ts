import {definitionListResponseSchema} from '@shipfox/api-definitions-dto';
import {ProjectNotFoundError, requireProjectAccess} from '@shipfox/api-projects';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listDefinitionsByProject} from '#db/definitions.js';
import {getLatestDefinitionSyncState} from '#db/sync-states.js';
import {toDefinitionDto, toDefinitionSyncSummaryDto} from '#presentation/dto/index.js';

export const listDefinitionsRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List all definitions for a project',
  schema: {
    querystring: z.object({
      project_id: z.string().uuid(),
    }),
    response: {
      200: definitionListResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ProjectNotFoundError) {
      throw new ClientError(error.message, 'project-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {project_id: projectId} = request.query;
    const {project} = await requireProjectAccess({request, projectId});
    const definitions = await listDefinitionsByProject(projectId);
    const syncState = await getLatestDefinitionSyncState({
      projectId,
      sourceConnectionId: project.sourceConnectionId,
      sourceExternalRepositoryId: project.sourceExternalRepositoryId,
    });

    return {
      definitions: definitions.map(toDefinitionDto),
      sync: toDefinitionSyncSummaryDto(syncState),
    };
  },
});
