import {requireUserContext} from '@shipfox/api-auth-context';
import {revokeProvisionerTokenResponseSchema} from '@shipfox/api-runners-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {ProvisionerTokenNotFoundError, revokeWorkspaceProvisionerToken} from '#core/index.js';
import {toProvisionerTokenDto} from '#presentation/dto/index.js';

export const revokeProvisionerTokenRoute = defineRoute({
  method: 'POST',
  path: '/:tokenId/revoke',
  description: 'Stop a provisioner token from being used to connect to your account',
  schema: {
    params: z.object({workspaceId: z.string().uuid(), tokenId: z.string().uuid()}),
    response: {
      200: revokeProvisionerTokenResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ProvisionerTokenNotFoundError) {
      throw new ClientError('Provisioner token not found', 'not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {workspaceId, tokenId} = request.params;
    await requireMembership({request, workspaceId});
    const user = requireUserContext(request);

    const revoked = await revokeWorkspaceProvisionerToken({
      tokenId,
      workspaceId,
      revokedByUserId: user.userId,
    });

    return toProvisionerTokenDto(revoked);
  },
});
