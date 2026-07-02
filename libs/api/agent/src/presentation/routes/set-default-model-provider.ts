import {
  getModelProviderEntry,
  setDefaultModelProviderBodySchema,
  setDefaultModelProviderResponseSchema,
} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {UnsupportedModelProviderError} from '#core/index.js';
import {setDefaultModelProvider} from '#db/index.js';
import {translateModelProviderRouteError} from './errors.js';

export const setDefaultModelProviderRoute = defineRoute({
  method: 'PUT',
  path: '/default-model-provider',
  description: 'Set the default model provider for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: setDefaultModelProviderBodySchema,
    response: {
      200: setDefaultModelProviderResponseSchema,
    },
  },
  errorHandler: translateModelProviderRouteError,
  handler: async (request) => {
    const {workspaceId} = request.params;
    await requireMembership({request, workspaceId});
    const entry = getModelProviderEntry(request.body.model_provider_id);
    if (entry === undefined || entry.support_status !== 'supported') {
      throw new UnsupportedModelProviderError(request.body.model_provider_id);
    }

    const settings = await setDefaultModelProvider({
      workspaceId,
      modelProviderId: request.body.model_provider_id,
    });

    return {default_model_provider_id: settings.defaultModelProviderId};
  },
});
