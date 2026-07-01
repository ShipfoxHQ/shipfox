import {listVariablesQuerySchema, listVariablesResponseSchema} from '@shipfox/api-secrets-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listManagedVariables} from '#core/index.js';
import {toVariableDto} from '#presentation/dto/index.js';
import {requireManagementRead} from './auth.js';
import {decodeManagementCursor, encodeManagementCursor} from './cursor.js';
import {translateManagementError} from './errors.js';

export const listVariablesRoute = defineRoute({
  method: 'GET',
  path: '/variables',
  description: 'List user-managed variables for a workspace or project scope.',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    querystring: listVariablesQuerySchema,
    response: {200: listVariablesResponseSchema},
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
    const result = await listManagedVariables({
      workspaceId,
      projectId,
      limit,
      cursor: decodedCursor ?? undefined,
    });

    return {
      variables: result.variables.map(toVariableDto),
      next_cursor: result.nextCursor ? encodeManagementCursor(result.nextCursor) : null,
    };
  },
});
