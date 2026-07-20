import {batchSecretsBodySchema, batchSecretsResponseSchema} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {setManagedSecrets} from '#core/index.js';
import {toSecretDto} from '#presentation/dto/index.js';
import type {ManagementAccessHelpers} from './auth.js';
import {translateManagementError} from './errors.js';
import {secretWarnings} from './warnings.js';

export function batchSecretsRoute(accessControl: ManagementAccessHelpers) {
  return defineRoute({
    method: 'POST',
    path: '/secrets::batch',
    description: 'Create or update multiple user-managed secrets in one scope.',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      body: batchSecretsBodySchema,
      response: {200: batchSecretsResponseSchema},
    },
    errorHandler: translateManagementError,
    handler: async (request) => {
      const {workspaceId} = request.params;
      const {project_id: projectId, entries} = request.body;
      const access = await accessControl.requireManagementWrite({request, workspaceId, projectId});
      const secrets = await setManagedSecrets({
        workspaceId,
        projectId,
        actorId: access.userId,
        entries,
      });

      return {secrets: secrets.map(toSecretDto), warnings: secretWarnings(entries)};
    },
  });
}
