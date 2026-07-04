import {
  discoverCustomModelProviderModelsBodySchema,
  discoverCustomModelProviderModelsResponseSchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {discoverCustomModelProviderModels} from '#core/index.js';
import {translateModelProviderRouteError} from './errors.js';

export const discoverCustomModelProviderModelsRoute = defineRoute({
  method: 'POST',
  path: '/custom-model-providers/discover-models',
  description: 'Discover models exposed by a custom model provider endpoint',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: discoverCustomModelProviderModelsBodySchema,
    response: {
      200: discoverCustomModelProviderModelsResponseSchema,
    },
  },
  errorHandler: translateModelProviderRouteError,
  handler: async (request) => {
    const {workspaceId} = request.params;
    requireWorkspaceAccess({request, workspaceId});

    return await discoverCustomModelProviderModels(request.body);
  },
});
