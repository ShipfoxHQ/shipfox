import {requireProvisionerContext} from '@shipfox/api-auth-context';
import {
  reconcileProvisionedRunnersBodySchema,
  reconcileProvisionedRunnersResponseSchema,
} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {reconcileProvisionedRunners} from '#core/index.js';
import {toReconcileProvisionedRunnersResponseDto} from '#presentation/dto/index.js';

export const reconcileProvisionedRunnersRoute = defineRoute({
  method: 'POST',
  path: '/provisioned-runners/reconcile',
  description: 'Reconcile provisioned runner state for a provisioner',
  schema: {
    body: reconcileProvisionedRunnersBodySchema,
    response: {
      200: reconcileProvisionedRunnersResponseSchema,
    },
  },
  handler: async (request) => {
    const {provisionerTokenId, workspaceId} = requireProvisionerContext(request);
    const result = await reconcileProvisionedRunners({
      workspaceId,
      provisionerId: provisionerTokenId,
      observedProvisionedRunnerIds: request.body.observed_provisioned_runner_ids,
    });

    return toReconcileProvisionedRunnersResponseDto(result);
  },
});
