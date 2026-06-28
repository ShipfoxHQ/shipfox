import {listAgentProviderConfigsResponseSchema} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getAgentWorkspaceSettings, listAgentProviderConfigs} from '#db/index.js';
import {toAgentProviderConfigDto} from '#presentation/dto/index.js';

export const listProviderConfigsRoute = defineRoute({
  method: 'GET',
  path: '/providers',
  description: 'List agent provider configurations for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    response: {
      200: listAgentProviderConfigsResponseSchema,
    },
  },
  handler: async (request) => {
    const {workspaceId} = request.params;
    await requireMembership({request, workspaceId});

    const [configs, settings] = await Promise.all([
      listAgentProviderConfigs(workspaceId),
      getAgentWorkspaceSettings(workspaceId),
    ]);

    return {
      configs: configs.map(toAgentProviderConfigDto),
      default_provider_id: settings?.defaultProviderId ?? null,
    };
  },
});
