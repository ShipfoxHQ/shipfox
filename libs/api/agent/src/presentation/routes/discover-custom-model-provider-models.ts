import {
  discoverCustomModelProviderModelsBodySchema,
  discoverCustomModelProviderModelsResponseSchema,
} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {discoverCustomModelProviderModels} from '#core/index.js';
import {requireCustomProviderAccess} from '#presentation/auth/require-custom-provider-access.js';
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
    await requireCustomProviderAccess({request, workspaceId});

    return await discoverCustomModelProviderModels(request.body);
  },
});
