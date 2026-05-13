import {requireUserContext} from '@shipfox/api-auth-context';
import {
  fireManualTriggerBodySchema,
  fireManualTriggerResponseSchema,
} from '@shipfox/api-triggers-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {TriggerSubscriptionNotFoundError, TriggerSubscriptionNotManualError} from '#core/errors.js';
import {fireManualSubscription} from '#core/fire-manual.js';
import {getTriggerSubscriptionById} from '#db/subscriptions.js';

export const fireManualTriggerRoute = defineRoute({
  method: 'POST',
  path: '/:id/fire',
  description: 'Fire a manual trigger subscription, creating a workflow run.',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: fireManualTriggerBodySchema,
    response: {
      201: fireManualTriggerResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof TriggerSubscriptionNotFoundError) {
      throw new ClientError(error.message, 'subscription-not-found', {status: 404});
    }
    if (error instanceof TriggerSubscriptionNotManualError) {
      throw new ClientError(error.message, 'subscription-not-manual', {status: 400});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {id: subscriptionId} = request.params;
    const userContext = requireUserContext(request);

    const subscription = await getTriggerSubscriptionById(subscriptionId);
    if (!subscription || !userContext.canAccess(subscription.workspaceId)) {
      throw new TriggerSubscriptionNotFoundError(subscriptionId);
    }

    const run = await fireManualSubscription({
      subscriptionId,
      callerWorkspaceId: subscription.workspaceId,
      userId: userContext.userId,
      inputs: request.body.inputs,
    });

    reply.status(201);
    return {run_id: run.id};
  },
});
