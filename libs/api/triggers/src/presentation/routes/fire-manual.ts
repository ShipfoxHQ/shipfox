import {requireUserContext} from '@shipfox/api-auth-context';
import {
  fireManualTriggerBodySchema,
  fireManualTriggerResponseSchema,
} from '@shipfox/api-triggers-dto';
import {InterpolationUnresolvableError} from '@shipfox/api-workflows';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {ManualTriggerNotFoundError} from '#core/errors.js';
import {fireManualSubscription} from '#core/fire-manual.js';
import {getManualSubscriptionByDefinitionId} from '#db/subscriptions.js';

export const fireManualTriggerRoute = defineRoute({
  method: 'POST',
  path: '/:definitionId/fire-manual',
  description: 'Fire the manual trigger of a workflow definition, creating a workflow run.',
  schema: {
    params: z.object({
      definitionId: z.string().uuid(),
    }),
    body: fireManualTriggerBodySchema,
    response: {
      201: fireManualTriggerResponseSchema,
      422: z.object({
        code: z.string(),
        details: z.object({
          field: z.string(),
          source: z.string(),
          env_key: z.string().optional(),
        }),
      }),
    },
  },
  errorHandler: (error) => {
    if (error instanceof ManualTriggerNotFoundError) {
      throw new ClientError(error.message, 'manual-trigger-not-found', {status: 404});
    }
    if (error instanceof InterpolationUnresolvableError) {
      throw new ClientError(error.message, 'workflow-interpolation-unresolvable', {
        status: 422,
        details: {
          field: error.field,
          source: error.source,
          ...(error.envKey === undefined ? {} : {env_key: error.envKey}),
        },
      });
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {definitionId} = request.params;
    const userContext = requireUserContext(request);

    const subscription = await getManualSubscriptionByDefinitionId(definitionId);
    // 404 covers both "no such manual trigger" and "not your workspace" to avoid leaking existence.
    if (!subscription || !userContext.canAccess(subscription.workspaceId)) {
      throw new ManualTriggerNotFoundError(definitionId);
    }

    const run = await fireManualSubscription({
      subscriptionId: subscription.id,
      callerWorkspaceId: subscription.workspaceId,
      userId: userContext.userId,
      inputs: request.body.inputs,
    });

    reply.status(201);
    return {workflow_run_id: run.id};
  },
});
