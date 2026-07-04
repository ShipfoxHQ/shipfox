import {revokeManualRegistrationTokenResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  ManualRegistrationTokenNotFoundError,
  revokeWorkspaceManualRegistrationToken,
} from '#core/index.js';
import {toManualRegistrationTokenDto} from '#presentation/dto/index.js';
import {requireManualRegistrationTokenWorkspaceMembership} from './workspace-membership.js';

export const revokeManualRegistrationTokenRoute = defineRoute({
  method: 'POST',
  path: '/:tokenId/revoke',
  description: 'Stop a manual registration token from being used to connect to your account',
  schema: {
    params: z.object({workspaceId: z.string().uuid(), tokenId: z.string().uuid()}),
    response: {
      200: revokeManualRegistrationTokenResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ManualRegistrationTokenNotFoundError) {
      throw new ClientError('Manual registration token not found', 'not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {workspaceId, tokenId} = request.params;
    requireManualRegistrationTokenWorkspaceMembership({request, workspaceId});

    const revoked = await revokeWorkspaceManualRegistrationToken({tokenId, workspaceId});

    return toManualRegistrationTokenDto(revoked);
  },
});
