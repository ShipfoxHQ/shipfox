import {
  modelProviderConfigDtoSchema,
  supportedModelProviderIdSchema,
  updateModelProviderConfigBodySchema,
} from '@shipfox/api-agent-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {testAndSaveModelProviderConfig} from '#core/index.js';
import {toModelProviderConfigDto} from '#presentation/dto/index.js';
import {translateModelProviderRouteError} from './errors.js';

export const upsertModelProviderConfigRoute = defineRoute({
  method: 'PUT',
  path: '/model-providers/:modelProviderId',
  description: 'Test and save an model provider configuration for a workspace',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      modelProviderId: supportedModelProviderIdSchema,
    }),
    body: updateModelProviderConfigBodySchema,
    response: {
      200: modelProviderConfigDtoSchema,
    },
  },
  errorHandler: translateModelProviderRouteError,
  handler: async (request, reply) => {
    const {workspaceId, modelProviderId} = request.params;
    const abortController = new AbortController();
    let responseFinished = false;
    reply.raw.on('finish', () => {
      responseFinished = true;
    });
    reply.raw.on('close', () => {
      if (!responseFinished) abortController.abort();
    });

    await requireMembership({request, workspaceId});

    const config = await testAndSaveModelProviderConfig({
      workspaceId,
      modelProviderId,
      ...('default_model' in request.body ? {defaultModel: request.body.default_model} : {}),
      credentials: request.body.credentials,
      setAsDefault: request.body.set_as_default,
      signal: abortController.signal,
    });

    return toModelProviderConfigDto(config);
  },
});
