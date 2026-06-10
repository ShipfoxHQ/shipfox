import {localWorkflowDetailSchema} from '@shipfox/api-local-workflows-dto';
import {requireProjectAccess} from '@shipfox/api-projects';
import {defineRoute} from '@shipfox/node-fastify';
import type {LocalWorkflowsService} from '#core/local-workflows.js';
import {localWorkflowsErrorHandler} from '../errors.js';
import {projectWorkflowParamsSchema} from '../schemas.js';

export function getWorkflowRoute(service: LocalWorkflowsService) {
  return defineRoute({
    method: 'GET',
    path: '/workflows/:workflowId',
    description: 'Get a local workflow registered in the V0 Local Service.',
    schema: {
      params: projectWorkflowParamsSchema,
      response: {
        200: localWorkflowDetailSchema,
      },
    },
    errorHandler: localWorkflowsErrorHandler,
    handler: async (request) => {
      await requireProjectAccess({request, projectId: request.params.projectId});
      return await service.getWorkflow(request.params.workflowId);
    },
  });
}
