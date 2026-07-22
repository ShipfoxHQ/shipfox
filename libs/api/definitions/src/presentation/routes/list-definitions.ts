import {
  definitionListQuerySchema,
  definitionListResponseSchema,
} from '@shipfox/api-definitions-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {decodeStringIdCursor, encodeStringIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {listDefinitions} from '#db/definitions.js';
import {getLatestDefinitionSyncState} from '#db/sync-states.js';
import {toDefinitionDto, toDefinitionSyncSummaryDto} from '#presentation/dto/index.js';
import {requireProjectAccess} from './project-access.js';

export function buildListDefinitionsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/',
    description: 'List all definitions for a project',
    schema: {
      querystring: definitionListQuerySchema,
      response: {
        200: definitionListResponseSchema,
      },
    },
    handler: async (request) => {
      const {project_id: projectId, limit, cursor} = request.query;
      const decodedCursor = decodeStringIdCursor(cursor);
      if (cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      const project = await requireProjectAccess(request, projectId, projects);
      const result = await listDefinitions({projectId, limit, cursor: decodedCursor});
      const syncState = await getLatestDefinitionSyncState({
        projectId,
        sourceConnectionId: project.sourceConnectionId,
        sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      });

      return {
        definitions: result.definitions.map(toDefinitionDto),
        sync: toDefinitionSyncSummaryDto(syncState),
        next_cursor: result.nextCursor ? encodeStringIdCursor(result.nextCursor) : null,
      };
    },
  });
}
