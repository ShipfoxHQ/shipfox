import {
  modelProviderConfigDtoSchema,
  supportedModelProviderIdSchema,
  updateModelProviderDefaultModelBodySchema,
} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {updateModelProviderConfigDefaultModel} from '#core/index.js';
import {toModelProviderConfigDto} from '#presentation/dto/index.js';
import {translateModelProviderRouteError} from './errors.js';

export const updateModelProviderDefaultModelRoute = defineRoute({
  method: 'PUT',
  path: '/model-providers/:modelProviderId/default-model',
  description: 'Update the default model for an existing model provider configuration',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      modelProviderId: supportedModelProviderIdSchema,
    }),
    body: updateModelProviderDefaultModelBodySchema,
    response: {
      200: modelProviderConfigDtoSchema,
    },
  },
  errorHandler: translateModelProviderRouteError,
  handler: async (request) => {
    const {workspaceId, modelProviderId} = request.params;
    await requireMembership({request, workspaceId});

    const config = await updateModelProviderConfigDefaultModel({
      workspaceId,
      modelProviderId,
      defaultModel: request.body.default_model,
    });

    return toModelProviderConfigDto(config);
  },
});
