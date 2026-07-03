import {
  modelProviderConfigResponseSchema,
  modelProviderRefSchema,
  updateModelProviderDefaultModelBodySchema,
} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {updateModelProviderConfigDefaultModel} from '#core/index.js';
import {getModelProviderConfig} from '#db/index.js';
import {requireCustomProviderAccess} from '#presentation/auth/require-custom-provider-access.js';
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
    const existingConfig = await getModelProviderConfig({workspaceId, providerId});
    if (existingConfig?.kind === 'custom') {
      await requireCustomProviderAccess({request, workspaceId});
    } else {
      await requireMembership({request, workspaceId});
    }

    const config = await updateModelProviderConfigDefaultModel({
      workspaceId,
      providerId,
      defaultModel: request.body.default_model,
    });

    return toModelProviderConfigResponseDto(config);
  },
});
