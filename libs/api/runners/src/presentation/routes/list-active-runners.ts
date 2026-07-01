import {activeRunnersResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listActiveRunners} from '#core/index.js';
import {toActiveRunnersResponseDto} from '#presentation/dto/index.js';
import {requireManualRegistrationTokenWorkspaceMembership} from './workspace-membership.js';

export const listActiveRunnersRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List active runners and provisioned runners for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: activeRunnersResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    await requireManualRegistrationTokenWorkspaceMembership({request, workspaceId});

    const runners = await listActiveRunners({workspaceId});
    return toActiveRunnersResponseDto(runners);
  },
});
