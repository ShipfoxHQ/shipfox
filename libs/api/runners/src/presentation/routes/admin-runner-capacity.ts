import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import {
  type AuthInterModuleClient,
  authInterModuleContract,
} from '@shipfox/api-auth-dto/inter-module';
import {adminRunnerCapacityResponseSchema as responseSchema} from '@shipfox/api-runners-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getWorkspaceCapacityUsage} from '#db/capacity-holds.js';

function translateError(error: unknown): never {
  if (
    isInterModuleKnownError(authInterModuleContract.methods.requireAdminRole, error) &&
    error.code === 'admin-role-required'
  ) {
    throw new ClientError('Administrator observer role required', 'forbidden', {
      status: 403,
      details: {required_role: error.details.requiredRole},
    });
  }
  throw error;
}

export function createAdminRunnerCapacityRoute(
  auth: Pick<AuthInterModuleClient, 'requireAdminRole'>,
) {
  return defineRoute({
    method: 'GET',
    path: '/',
    auth: AUTH_USER,
    description: 'Read installation runner capacity usage for an administrator.',
    schema: {
      params: z.object({workspaceId: z.string().uuid()}),
      response: {200: responseSchema},
    },
    errorHandler: translateError,
    handler: async (request) => {
      const actor = requireUserContext(request);
      await auth.requireAdminRole({userId: actor.userId, minimumRole: 'admin-observer'});
      const [usage] = await getWorkspaceCapacityUsage({workspaceIds: [request.params.workspaceId]});
      return {
        workspace_id: request.params.workspaceId,
        units_in_use: usage?.unitsInUse ?? 0,
        queued_for_capacity: usage?.queuedForCapacity ?? 0,
      };
    },
  });
}
