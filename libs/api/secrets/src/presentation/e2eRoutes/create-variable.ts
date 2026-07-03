import {
  e2eCreateVariableBodySchema,
  e2eCreateVariableResponseSchema,
} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {setManagedVariables} from '#core/index.js';
import {toVariableDto} from '#presentation/dto/index.js';
import {translateManagementError} from '#presentation/routes/errors.js';

export const createE2eVariableRoute = defineRoute({
  method: 'POST',
  path: '/variable',
  description: 'Create a workspace variable for E2E tests.',
  schema: {
    body: e2eCreateVariableBodySchema,
    response: {201: e2eCreateVariableResponseSchema},
  },
  errorHandler: translateManagementError,
  handler: async (request, reply) => {
    const [variable] = await setManagedVariables({
      workspaceId: request.body.workspace_id,
      actorId: request.body.actor_id,
      projectId: request.body.project_id,
      entries: [{key: request.body.key, value: request.body.value}],
    });
    if (!variable) throw new Error('E2E variable setup returned no row');

    reply.code(201);
    return toVariableDto(variable);
  },
});
