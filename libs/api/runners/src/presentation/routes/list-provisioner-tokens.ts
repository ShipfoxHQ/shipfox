import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {listProvisionerTokensResponseSchema} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listUsableProvisionerTokens} from '#core/index.js';
import {toProvisionerTokenDto} from '#presentation/dto/index.js';

export const listProvisionerTokensRoute = defineRoute({
  method: 'GET',
  path: '/',
  description: 'List currently usable provisioner tokens for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: listProvisionerTokensResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    requireWorkspaceAccess({request, workspaceId});

    const tokens = await listUsableProvisionerTokens(workspaceId);
    return {tokens: tokens.map(toProvisionerTokenDto)};
  },
});
