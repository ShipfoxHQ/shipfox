import {
  putSecretBodySchema,
  putSecretResponseSchema,
  secretKeySchema,
} from '@shipfox/api-secrets-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {setManagedSecrets} from '#core/index.js';
import {toSecretDto} from '#presentation/dto/index.js';
import {requireManagementWrite} from './auth.js';
import {translateManagementError} from './errors.js';
import {secretWarnings} from './warnings.js';

export const putSecretRoute = defineRoute({
  method: 'PUT',
  path: '/secrets/:key',
  description: 'Create or update a user-managed secret.',
  schema: {
    params: z.object({workspaceId: z.string().uuid(), key: secretKeySchema}),
    body: putSecretBodySchema,
    response: {200: putSecretResponseSchema},
  },
  errorHandler: translateManagementError,
  handler: async (request) => {
    const {workspaceId, key} = request.params;
    const {project_id: projectId, value} = request.body;
    const access = await requireManagementWrite({request, workspaceId, projectId});
    const entries = [{key, value}];
    const [secret] = await setManagedSecrets({
      workspaceId,
      projectId,
      actorId: access.userId,
      entries,
    });
    if (!secret) throw new Error('Secret write returned no row');

    return {secret: toSecretDto(secret), warnings: secretWarnings(entries)};
  },
});
