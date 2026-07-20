import {
  putVariableBodySchema,
  putVariableResponseSchema,
  secretKeySchema,
} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {setManagedVariables} from '#core/index.js';
import {toVariableDto} from '#presentation/dto/index.js';
import type {ManagementAccessHelpers} from './auth.js';
import {translateManagementError} from './errors.js';
import {variableWarnings} from './warnings.js';

export function putVariableRoute(accessControl: ManagementAccessHelpers) {
  return defineRoute({
    method: 'PUT',
    path: '/variables/:key',
    description: 'Create or update a user-managed variable.',
    schema: {
      params: z.object({workspaceId: z.string().uuid(), key: secretKeySchema}),
      body: putVariableBodySchema,
      response: {200: putVariableResponseSchema},
    },
    errorHandler: translateManagementError,
    handler: async (request) => {
      const {workspaceId, key} = request.params;
      const {project_id: projectId, value} = request.body;
      const access = await accessControl.requireManagementWrite({request, workspaceId, projectId});
      const entries = [{key, value}];
      const [variable] = await setManagedVariables({
        workspaceId,
        projectId,
        actorId: access.userId,
        entries,
      });
      if (!variable) throw new Error('Variable write returned no row');

      return {variable: toVariableDto(variable), warnings: variableWarnings(entries)};
    },
  });
}
