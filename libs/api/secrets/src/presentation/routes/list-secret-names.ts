import {secretNamesResponseSchema, secretScopeQuerySchema} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listManagedSecretNames} from '#core/index.js';
import type {ManagementAccessHelpers} from './auth.js';

export function listSecretNamesRoute(accessControl: ManagementAccessHelpers) {
  return defineRoute({
    method: 'GET',
    path: '/secrets/names',
    description: 'List secret names for a workspace or project scope.',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      querystring: secretScopeQuerySchema,
      response: {200: secretNamesResponseSchema},
    },
    handler: async (request) => {
      const {workspaceId} = request.params;
      const {project_id: projectId} = request.query;

      await accessControl.requireManagementRead({request, workspaceId, projectId});
      return await listManagedSecretNames({workspaceId, projectId});
    },
  });
}
