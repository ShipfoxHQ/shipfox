import {modelProviderRefSchema} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {deleteModelProviderConfig} from '#db/index.js';

export const deleteModelProviderConfigRoute = defineRoute({
  method: 'DELETE',
  path: '/model-providers/:modelProviderId',
  description: 'Delete an model provider configuration for a workspace',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      modelProviderId: modelProviderRefSchema,
    }),
    response: {
      204: z.void(),
    },
  },
  handler: async (request, reply) => {
    const {workspaceId, modelProviderId} = request.params;
    await requireMembership({request, workspaceId});

    const deleted = await deleteModelProviderConfig({workspaceId, modelProviderId});
    if (!deleted) {
      throw new ClientError('Model provider configuration not found', 'not-found', {status: 404});
    }

    reply.code(204);
  },
});
