import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  attachProviderRunnerBodySchema,
  attachProviderRunnerResponseSchema,
  createPlannedCapacityBodySchema,
  createPlannedCapacityResponseSchema,
} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {attachProviderRunnerId, createPlannedProvisionedCapacity} from '#core/index.js';

export const createPlannedCapacityRoute = defineRoute({
  method: 'POST',
  path: '/capacity',
  description: 'Create provisioner-owned capacity before provider launch',
  schema: {
    body: createPlannedCapacityBodySchema,
    response: {200: createPlannedCapacityResponseSchema},
  },
  handler: async (request) => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    const result = await createPlannedProvisionedCapacity({
      provisionerId: provisionerTokenId,
      providerKind: request.body.provider_kind ?? null,
      templateKey: request.body.template_key ?? null,
    });
    return {capacity_id: result.capacityId};
  },
});

export const attachProviderRunnerRoute = defineRoute({
  method: 'POST',
  path: '/capacity/:capacityId/provider-runner',
  description: 'Attach a provider runner identity to planned capacity once',
  schema: {
    params: z.object({capacityId: z.string().uuid()}),
    body: attachProviderRunnerBodySchema,
    response: {200: attachProviderRunnerResponseSchema},
  },
  handler: async (request) => {
    const {provisionerTokenId} = requireProvisionerContext(request);
    const attached = await attachProviderRunnerId({
      capacityId: request.params.capacityId,
      provisionerId: provisionerTokenId,
      providerRunnerId: request.body.provider_runner_id,
    });
    return {attached};
  },
});
