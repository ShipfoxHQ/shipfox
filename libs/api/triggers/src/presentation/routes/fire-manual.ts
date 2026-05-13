import {requireUserContext} from '@shipfox/api-auth-context';
import {
  fireManualTriggerBodySchema,
  fireManualTriggerResponseSchema,
} from '@shipfox/api-triggers-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {ManualTriggerNotFoundError} from '#core/errors.js';
import {fireManualSubscription} from '#core/fire-manual.js';
import {getManualSubscriptionByDefinitionId} from '#db/subscriptions.js';

/**
 * Fire the manual trigger declared by a workflow definition.
 *
 * The route is keyed by workflow definition id (not subscription id) so
 * the client can call it with the definition it already has on hand. The
 * parser enforces "at most one manual trigger per workflow", which makes
 * this lookup unambiguous.
 *
 * Returns 404 when the workspace cannot access the workflow *or* when the
 * workflow declares no manual trigger. The two cases are conflated on
 * purpose: leaking "workflow exists but you can't reach it" via the
 * payload-shaped error would be a small access-control leak.
 */
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
    },
  },
  errorHandler: (error) => {
    if (error instanceof ManualTriggerNotFoundError) {
      throw new ClientError(error.message, 'manual-trigger-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {definitionId} = request.params;
    const userContext = requireUserContext(request);

    const subscription = await getManualSubscriptionByDefinitionId(definitionId);
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
    return {run_id: run.id};
  },
});
