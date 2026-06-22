import {requireUserContext} from '@shipfox/api-auth-context';
import {triggerEventDetailResponseSchema} from '@shipfox/api-triggers-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getTriggerEventById, listDecisionsByReceivedEventId} from '#db/index.js';
import {toTriggerDecisionDto, toTriggerEventDto} from '#presentation/dto/trigger-events.js';

export const getTriggerEventRoute = defineRoute({
  method: 'GET',
  path: '/:id',
  description: 'Get a trigger event by ID with its routing decisions.',
  schema: {
    params: z.object({
      id: z.string().uuid(),
    }),
    response: {
      200: triggerEventDetailResponseSchema,
    },
  },
  handler: async (request) => {
    const {id} = request.params;
    const userContext = requireUserContext(request);

    const event = await getTriggerEventById(id);
    // 404 covers both "no such event" and "not your workspace" to avoid leaking existence.
    if (!event || !userContext.canAccess(event.workspaceId)) {
      throw new ClientError('Trigger event not found', 'not-found', {status: 404});
    }

    const decisions = await listDecisionsByReceivedEventId(event.id);

    return {
      ...toTriggerEventDto(event),
      decisions: decisions.map(toTriggerDecisionDto),
    };
  },
});
