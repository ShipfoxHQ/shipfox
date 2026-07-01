import {agentProviderRefSchema} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {deleteAgentProviderConfig} from '#db/index.js';

export const deleteProviderConfigRoute = defineRoute({
  method: 'DELETE',
  path: '/providers/:providerId',
  description: 'Delete an agent provider configuration for a workspace',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      providerId: agentProviderRefSchema,
    }),
    response: {
      204: z.void(),
    },
  },
  handler: async (request, reply) => {
    const {workspaceId, providerId} = request.params;
    await requireMembership({request, workspaceId});

    const deleted = await deleteAgentProviderConfig({workspaceId, providerId});
    if (!deleted) {
      throw new ClientError('Provider configuration not found', 'not-found', {status: 404});
    }

    reply.code(204);
  },
});
