import {
  agentProviderConfigDtoSchema,
  supportedAgentProviderIdSchema,
  updateAgentProviderConfigBodySchema,
} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {testAndSaveProviderConfig} from '#core/index.js';
import {toAgentProviderConfigDto} from '#presentation/dto/index.js';
import {translateAgentProviderRouteError} from './errors.js';

export const upsertProviderConfigRoute = defineRoute({
  method: 'PUT',
  path: '/providers/:providerId',
  description: 'Test and save an agent provider configuration for a workspace',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      providerId: supportedAgentProviderIdSchema,
    }),
    body: updateAgentProviderConfigBodySchema,
    response: {
      200: agentProviderConfigDtoSchema,
    },
  },
  errorHandler: translateAgentProviderRouteError,
  handler: async (request) => {
    const {workspaceId, providerId} = request.params;
    await requireMembership({request, workspaceId});

    const config = await testAndSaveProviderConfig({
      workspaceId,
      providerId,
      credentials: request.body.credentials,
    });

    return toAgentProviderConfigDto(config);
  },
});
