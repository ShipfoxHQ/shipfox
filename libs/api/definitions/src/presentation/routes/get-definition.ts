import {definitionResponseSchema} from '@shipfox/api-definitions-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getDefinitionById} from '#db/definitions.js';
import {toDefinitionDto} from '#presentation/dto/index.js';
import {requireProjectAccess} from './project-access.js';

export function buildGetDefinitionRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/:id',
    description: 'Get a definition by ID',
    schema: {
      params: z.object({
        id: z.string().uuid(),
      }),
      response: {
        200: definitionResponseSchema,
      },
    },
    handler: async (request) => {
      const {id} = request.params;
      const definition = await getDefinitionById(id);

      if (!definition) {
        throw new ClientError('Definition not found', 'not-found', {status: 404});
      }
      await requireProjectAccess(request, definition.projectId, projects);

      return toDefinitionDto(definition);
    },
  });
}
