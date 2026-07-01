import {
  getVariableResponseSchema,
  secretKeySchema,
  secretScopeQuerySchema,
} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getManagedVariable} from '#core/index.js';
import {toVariableDto} from '#presentation/dto/index.js';
import {requireManagementRead} from './auth.js';
import {translateManagementError} from './errors.js';

export const getVariableRoute = defineRoute({
  method: 'GET',
  path: '/variables/:key',
  description: 'Read a user-managed variable.',
  schema: {
    params: z.object({workspaceId: z.string().uuid(), key: secretKeySchema}),
    querystring: secretScopeQuerySchema,
    response: {200: getVariableResponseSchema},
  },
  errorHandler: translateManagementError,
  handler: async (request) => {
    const {workspaceId, key} = request.params;
    const {project_id: projectId} = request.query;

    await requireManagementRead({request, workspaceId, projectId});
    const variable = await getManagedVariable({workspaceId, projectId, key});

    return {variable: toVariableDto(variable)};
  },
});
