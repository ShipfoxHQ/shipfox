import {
  triggerFakeAlertBodySchema,
  triggerFakeAlertResponseSchema,
} from '@shipfox/api-local-workflows-dto';
import {requireProjectAccess} from '@shipfox/api-projects';
import {defineRoute} from '@shipfox/node-fastify';
import type {LocalWorkflowsService} from '#core/local-workflows.js';
import {localWorkflowsErrorHandler} from './errors.js';
import {projectParamsSchema} from './schemas.js';

export function triggerFakeAlertRoute(service: LocalWorkflowsService) {
  return defineRoute({
    method: 'POST',
    path: '/fake-alerts',
    description: 'Forward a fake monitoring alert to the V0 Local Service.',
    schema: {
      params: projectParamsSchema,
      body: triggerFakeAlertBodySchema,
      response: {
        200: triggerFakeAlertResponseSchema,
      },
    },
    errorHandler: localWorkflowsErrorHandler,
    handler: async (request) => {
      await requireProjectAccess({request, projectId: request.params.projectId});
      return await service.triggerFakeAlert(request.body, request.params.projectId);
    },
  });
}
