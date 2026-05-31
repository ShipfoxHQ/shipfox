import {localWorkflowRunListSchema} from '@shipfox/api-local-workflows-dto';
import {requireProjectAccess} from '@shipfox/api-projects';
import {defineRoute} from '@shipfox/node-fastify';
import type {LocalWorkflowsService} from '#core/local-workflows.js';
import {localWorkflowsErrorHandler} from '../errors.js';
import {projectParamsSchema} from '../schemas.js';

export function listRunsRoute(service: LocalWorkflowsService) {
  return defineRoute({
    method: 'GET',
    path: '/runs',
    description: 'List persisted local workflow runs from the V0 Local Service.',
    schema: {
      params: projectParamsSchema,
      response: {
        200: localWorkflowRunListSchema,
      },
    },
    errorHandler: localWorkflowsErrorHandler,
    handler: async (request) => {
      await requireProjectAccess({request, projectId: request.params.projectId});
      return await service.listRuns();
    },
  });
}
