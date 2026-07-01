import {listSecretsQuerySchema, listSecretsResponseSchema} from '@shipfox/api-secrets-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listManagedSecrets} from '#core/index.js';
import {toSecretDto} from '#presentation/dto/index.js';
import {requireManagementRead} from './auth.js';
import {decodeManagementCursor, encodeManagementCursor} from './cursor.js';
import {translateManagementError} from './errors.js';

export const listSecretsRoute = defineRoute({
  method: 'GET',
  path: '/secrets',
  description: 'List user-managed secrets for a workspace or project scope.',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    querystring: listSecretsQuerySchema,
    response: {200: listSecretsResponseSchema},
  },
  errorHandler: translateManagementError,
  handler: async (request) => {
    const {workspaceId} = request.params;
    const {project_id: projectId, limit, cursor} = request.query;
    const decodedCursor = decodeManagementCursor(cursor);
    if (cursor && !decodedCursor) {
      throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
    }

    await requireManagementRead({request, workspaceId, projectId});
    const result = await listManagedSecrets({
      workspaceId,
      projectId,
      limit,
      cursor: decodedCursor ?? undefined,
    });

    return {
      secrets: result.secrets.map(toSecretDto),
      next_cursor: result.nextCursor ? encodeManagementCursor(result.nextCursor) : null,
    };
  },
});
