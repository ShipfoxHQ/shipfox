import {batchVariablesBodySchema, batchVariablesResponseSchema} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {setManagedVariables} from '#core/index.js';
import {toVariableDto} from '#presentation/dto/index.js';
import type {ManagementAccessHelpers} from './auth.js';
import {translateManagementError} from './errors.js';
import {variableWarnings} from './warnings.js';

export function batchVariablesRoute(accessControl: ManagementAccessHelpers) {
  return defineRoute({
    method: 'POST',
    path: '/variables::batch',
    description: 'Create or update multiple user-managed variables in one scope.',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      body: batchVariablesBodySchema,
      response: {200: batchVariablesResponseSchema},
    },
    errorHandler: translateManagementError,
    handler: async (request) => {
      const {workspaceId} = request.params;
      const {project_id: projectId, entries} = request.body;
      const access = await accessControl.requireManagementWrite({request, workspaceId, projectId});
      const variables = await setManagedVariables({
        workspaceId,
        projectId,
        actorId: access.userId,
        entries,
      });

      return {variables: variables.map(toVariableDto), warnings: variableWarnings(entries)};
    },
  });
}
