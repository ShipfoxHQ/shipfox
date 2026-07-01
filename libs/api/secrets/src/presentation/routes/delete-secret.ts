import {secretKeySchema, secretScopeQuerySchema} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {deleteManagedSecret} from '#core/index.js';
import {requireManagementWrite} from './auth.js';
import {translateManagementError} from './errors.js';

export const deleteSecretRoute = defineRoute({
  method: 'DELETE',
  path: '/secrets/:key',
  description: 'Delete a user-managed secret.',
  schema: {
    params: z.object({workspaceId: z.string().uuid(), key: secretKeySchema}),
    querystring: secretScopeQuerySchema,
    response: {204: z.null()},
  },
  errorHandler: translateManagementError,
  handler: async (request, reply) => {
    const {workspaceId, key} = request.params;
    const {project_id: projectId} = request.query;
    const access = await requireManagementWrite({request, workspaceId, projectId});

    await deleteManagedSecret({workspaceId, projectId, key, actorId: access.userId});
    return reply.status(204).send();
  },
});
