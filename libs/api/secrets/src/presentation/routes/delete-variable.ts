import {secretKeySchema, secretScopeQuerySchema} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {deleteManagedVariable} from '#core/index.js';
import type {ManagementAccessHelpers} from './auth.js';
import {translateManagementError} from './errors.js';

export function deleteVariableRoute(accessControl: ManagementAccessHelpers) {
  return defineRoute({
    method: 'DELETE',
    path: '/variables/:key',
    description: 'Delete a user-managed variable.',
    schema: {
      params: z.object({workspaceId: z.string().uuid(), key: secretKeySchema}),
      querystring: secretScopeQuerySchema,
      response: {204: z.void()},
    },
    errorHandler: translateManagementError,
    handler: async (request, reply) => {
      const {workspaceId, key} = request.params;
      const {project_id: projectId} = request.query;
      const access = await accessControl.requireManagementWrite({request, workspaceId, projectId});

      await deleteManagedVariable({workspaceId, projectId, key, actorId: access.userId});
      return reply.status(204).send();
    },
  });
}
