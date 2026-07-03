import {modelProviderRefSchema} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {deleteModelProviderConfig} from '#core/index.js';
import {getModelProviderConfig} from '#db/index.js';
import {requireCustomProviderAccess} from '#presentation/auth/require-custom-provider-access.js';

export const deleteModelProviderConfigRoute = defineRoute({
  method: 'DELETE',
  path: '/model-providers/:providerId',
  description: 'Delete a model provider configuration for a workspace',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      providerId: modelProviderRefSchema,
    }),
    response: {
      204: z.void(),
    },
  },
  handler: async (request, reply) => {
    const {workspaceId, providerId} = request.params;
    const existingConfig = await getModelProviderConfig({workspaceId, providerId});
    if (existingConfig?.kind === 'custom') {
      await requireCustomProviderAccess({request, workspaceId});
    } else {
      await requireMembership({request, workspaceId});
    }

    const deleted = await deleteModelProviderConfig({workspaceId, providerId});
    if (!deleted) {
      throw new ClientError('Model provider configuration not found', 'not-found', {status: 404});
    }

    reply.code(204);
  },
});
