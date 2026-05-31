import {localWorkflowRunDetailSchema} from '@shipfox/api-local-workflows-dto';
import {requireProjectAccess} from '@shipfox/api-projects';
import {defineRoute} from '@shipfox/node-fastify';
import type {LocalWorkflowsService} from '#core/local-workflows.js';
import {localWorkflowsErrorHandler} from '../errors.js';
import {projectRunParamsSchema} from '../schemas.js';

export function getRunRoute(service: LocalWorkflowsService) {
  return defineRoute({
    method: 'GET',
    path: '/runs/:runId',
    description: 'Get a persisted local workflow run graph from the V0 Local Service.',
    schema: {
      params: projectRunParamsSchema,
      response: {
        200: localWorkflowRunDetailSchema,
      },
    },
    errorHandler: localWorkflowsErrorHandler,
    handler: async (request) => {
      await requireProjectAccess({request, projectId: request.params.projectId});
      return await service.getRun(request.params.runId);
    },
  });
}
