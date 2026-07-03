import {
  getModelProviderEntry,
  setDefaultModelProviderBodySchema,
  setDefaultModelProviderResponseSchema,
} from '@shipfox/api-agent-dto';
import {requireWorkspaceAccess} from '@shipfox/api-auth-context';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {
  CustomModelProviderDefaultUnsupportedError,
  UnsupportedModelProviderError,
} from '#core/index.js';
import {getModelProviderConfig, setDefaultModelProvider} from '#db/index.js';
import {requireCustomProviderAccess} from '#presentation/auth/require-custom-provider-access.js';
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
    const existingConfig = await getModelProviderConfig({
      workspaceId,
      providerId: request.body.provider_id,
    });
    if (existingConfig?.kind === 'custom') {
      requireCustomProviderAccess({request, workspaceId});
      throw new CustomModelProviderDefaultUnsupportedError(request.body.provider_id);
    } else {
      requireWorkspaceAccess({request, workspaceId});
      const entry = getModelProviderEntry(request.body.provider_id);
      if (entry === undefined || entry.support_status !== 'supported') {
        throw new UnsupportedModelProviderError(request.body.provider_id);
      }
    }

    const settings = await setDefaultModelProvider({
      workspaceId,
      providerId: request.body.provider_id,
    });

    return {default_provider_id: settings.defaultProviderId};
  },
});
