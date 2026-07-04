import {listModelProviderConfigsResponseSchema} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getAgentWorkspaceSettings, listModelProviderConfigs} from '#db/index.js';
import {toModelProviderConfigResponseDto} from '#presentation/dto/index.js';

export const listModelProviderConfigsRoute = defineRoute({
  method: 'GET',
  path: '/model-providers',
  description: 'List model provider configurations for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: listModelProviderConfigsResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    requireWorkspaceAccess({request, workspaceId});

    const [configs, settings] = await Promise.all([
      listModelProviderConfigs(workspaceId),
      getAgentWorkspaceSettings(workspaceId),
    ]);

    return {
      configs: configs.map(toModelProviderConfigResponseDto),
      default_provider_id: settings?.defaultProviderId ?? null,
    };
  },
});
