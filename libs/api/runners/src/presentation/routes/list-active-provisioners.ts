import {listActiveProvisionersResponseSchema} from '@shipfox/api-runners-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listActiveProvisioners} from '#core/index.js';
import {toActiveProvisionerDto} from '#presentation/dto/index.js';

export const listActiveProvisionersRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List active provisioners for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: listActiveProvisionersResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    await requireMembership({request, workspaceId});

    const provisioners = await listActiveProvisioners(workspaceId);
    return {provisioners: provisioners.map(toActiveProvisionerDto)};
  },
});
