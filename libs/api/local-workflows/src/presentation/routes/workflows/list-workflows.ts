import {localWorkflowListSchema} from '@shipfox/api-local-workflows-dto';
import {requireProjectAccess} from '@shipfox/api-projects';
import {defineRoute} from '@shipfox/node-fastify';
import type {LocalWorkflowsService} from '#core/local-workflows.js';
import {localWorkflowsErrorHandler} from '../errors.js';
import {projectParamsSchema} from '../schemas.js';

export function listWorkflowsRoute(service: LocalWorkflowsService) {
  return defineRoute({
    method: 'GET',
    path: '/workflows',
    description: 'List local workflows registered in the V0 Local Service.',
    schema: {
      params: projectParamsSchema,
      response: {
        200: localWorkflowListSchema,
      },
    },
    errorHandler: localWorkflowsErrorHandler,
    handler: async (request) => {
      await requireProjectAccess({request, projectId: request.params.projectId});
      return await service.listWorkflows();
    },
  });
}
