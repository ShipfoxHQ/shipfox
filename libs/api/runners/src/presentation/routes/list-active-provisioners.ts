import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {listActiveProvisionersResponseSchema} from '@shipfox/api-runners-dto';
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
    requireWorkspaceAccess({request, workspaceId});

    const provisioners = await listActiveProvisioners(workspaceId);
    return {provisioners: provisioners.map(toActiveProvisionerDto)};
  },
});
