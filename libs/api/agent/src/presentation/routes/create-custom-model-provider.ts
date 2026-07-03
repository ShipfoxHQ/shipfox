import {
  createCustomModelProviderBodySchema,
  customModelProviderConfigDtoSchema,
} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {createCustomModelProviderConfig} from '#core/index.js';
import {requireCustomProviderAccess} from '#presentation/auth/require-custom-provider-access.js';
import {toCustomModelProviderConfigDto} from '#presentation/dto/index.js';
import {translateModelProviderRouteError} from './errors.js';

export const createCustomModelProviderRoute = defineRoute({
  method: 'POST',
  path: '/custom-model-providers',
  description: 'Create a custom model provider configuration for a workspace',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: createCustomModelProviderBodySchema,
    response: {
      200: customModelProviderConfigDtoSchema,
    },
  },
  errorHandler: translateModelProviderRouteError,
  handler: async (request, reply) => {
    const {workspaceId} = request.params;
    const abortController = new AbortController();
    let responseFinished = false;
    reply.raw.on('finish', () => {
      responseFinished = true;
    });
    reply.raw.on('close', () => {
      if (!responseFinished) abortController.abort();
    });

    await requireCustomProviderAccess({request, workspaceId});

    const config = await createCustomModelProviderConfig({
      workspaceId,
      body: request.body,
      signal: abortController.signal,
    });

    return toCustomModelProviderConfigDto(config);
  },
});
