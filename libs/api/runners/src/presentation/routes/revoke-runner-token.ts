import {revokeRunnerTokenResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {RunnerTokenNotFoundError, revokeWorkspaceRunnerToken} from '#core/index.js';
import {toRunnerTokenDto} from '#presentation/dto/index.js';
import {requireRunnerTokenWorkspaceMembership} from './workspace-membership.js';

export const revokeRunnerTokenRoute = defineRoute({
  method: 'POST',
  path: '/:tokenId/revoke',
  description: 'Stop a runner token from being used to connect to your account',
  schema: {
    params: z.object({workspaceId: z.string().uuid(), tokenId: z.string().uuid()}),
    response: {
      200: revokeRunnerTokenResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof RunnerTokenNotFoundError) {
      throw new ClientError('Runner token not found', 'not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {workspaceId, tokenId} = request.params;
    await requireRunnerTokenWorkspaceMembership({request, workspaceId});

    const revoked = await revokeWorkspaceRunnerToken({tokenId, workspaceId});

    return toRunnerTokenDto(revoked);
  },
});
