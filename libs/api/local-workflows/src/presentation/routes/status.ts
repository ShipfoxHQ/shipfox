import {localWorkflowStatusSchema} from '@shipfox/api-local-workflows-dto';
import {requireProjectAccess} from '@shipfox/api-projects';
import {defineRoute} from '@shipfox/node-fastify';
import type {LocalWorkflowsService} from '#core/local-workflows.js';
import {localWorkflowsErrorHandler} from './errors.js';
import {projectParamsSchema} from './schemas.js';

export function getStatusRoute(service: LocalWorkflowsService) {
  return defineRoute({
    method: 'GET',
    path: '/status',
    description: 'Get local workflows service status for a project.',
    schema: {
      params: projectParamsSchema,
      response: {
        200: localWorkflowStatusSchema,
      },
    },
    errorHandler: localWorkflowsErrorHandler,
    handler: async (request) => {
      await requireProjectAccess({request, projectId: request.params.projectId});
      return await service.getStatus();
    },
  });
}
