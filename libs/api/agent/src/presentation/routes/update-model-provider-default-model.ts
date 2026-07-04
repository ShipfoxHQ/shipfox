import {
  modelProviderConfigResponseSchema,
  modelProviderRefSchema,
  updateModelProviderDefaultModelBodySchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {updateModelProviderConfigDefaultModel} from '#core/index.js';
import {toModelProviderConfigResponseDto} from '#presentation/dto/index.js';
import {translateModelProviderRouteError} from './errors.js';

export const updateModelProviderDefaultModelRoute = defineRoute({
  method: 'PUT',
  path: '/model-providers/:providerId/default-model',
  description: 'Update the default model for an existing model provider configuration',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      providerId: modelProviderRefSchema,
    }),
    body: updateModelProviderDefaultModelBodySchema,
    response: {
      200: modelProviderConfigResponseSchema,
    },
  },
  errorHandler: translateModelProviderRouteError,
  handler: async (request) => {
    const {workspaceId, providerId} = request.params;
    requireWorkspaceAccess({request, workspaceId});

    const config = await updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId,
      defaultModel: request.body.default_model,
    });

    return toModelProviderConfigResponseDto(config);
  },
});
