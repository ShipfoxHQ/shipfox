import {secretScopeQuerySchema, variableNamesResponseSchema} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listManagedVariableNames} from '#core/index.js';
import type {ManagementAccessHelpers} from './auth.js';

export function listVariableNamesRoute(accessControl: ManagementAccessHelpers) {
  return defineRoute({
    method: 'GET',
    path: '/variables/names',
    description: 'List variable names for a workspace or project scope.',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      querystring: secretScopeQuerySchema,
      response: {200: variableNamesResponseSchema},
    },
    handler: async (request) => {
      const {workspaceId} = request.params;
      const {project_id: projectId} = request.query;

      await accessControl.requireManagementRead({request, workspaceId, projectId});
      return await listManagedVariableNames({workspaceId, projectId});
    },
  });
}
