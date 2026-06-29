import {
  agentProviderConfigDtoSchema,
  supportedAgentProviderIdSchema,
  updateAgentProviderDefaultModelBodySchema,
} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {updateProviderConfigDefaultModel} from '#core/index.js';
import {toAgentProviderConfigDto} from '#presentation/dto/index.js';
import {translateAgentProviderRouteError} from './errors.js';

export const updateProviderDefaultModelRoute = defineRoute({
  method: 'PUT',
  path: '/providers/:providerId/default-model',
  description: 'Update the default model for an existing agent provider configuration',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      providerId: supportedAgentProviderIdSchema,
    }),
    body: updateAgentProviderDefaultModelBodySchema,
    response: {
      200: agentProviderConfigDtoSchema,
    },
  },
  errorHandler: translateAgentProviderRouteError,
  handler: async (request) => {
    const {workspaceId, providerId} = request.params;
    await requireMembership({request, workspaceId});

    const config = await updateProviderConfigDefaultModel({
      workspaceId,
      providerId,
      defaultModel: request.body.default_model,
    });

    return toAgentProviderConfigDto(config);
  },
});
