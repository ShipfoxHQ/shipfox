import {
  getAgentProviderEntry,
  setDefaultAgentProviderBodySchema,
  setDefaultAgentProviderResponseSchema,
} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {UnsupportedAgentProviderError} from '#core/index.js';
import {setDefaultAgentProvider} from '#db/index.js';
import {translateAgentProviderRouteError} from './errors.js';

export const setDefaultProviderRoute = defineRoute({
  method: 'PUT',
  path: '/default-provider',
  description: 'Set the default agent provider for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: setDefaultAgentProviderBodySchema,
    response: {
      200: setDefaultAgentProviderResponseSchema,
    },
  },
  errorHandler: translateAgentProviderRouteError,
  handler: async (request) => {
    const {workspaceId} = request.params;
    await requireMembership({request, workspaceId});
    const entry = getAgentProviderEntry(request.body.provider_id);
    if (entry === undefined || entry.support_status !== 'supported') {
      throw new UnsupportedAgentProviderError(request.body.provider_id);
    }

    const settings = await setDefaultAgentProvider({
      workspaceId,
      providerId: request.body.provider_id,
    });

    return {default_provider_id: settings.defaultProviderId};
  },
});
