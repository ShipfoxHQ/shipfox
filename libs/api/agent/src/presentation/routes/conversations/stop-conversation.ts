import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {requestTurnStop} from '#db/turn-runtime.js';
import {requireWebConversation} from './access.js';

export const stopConversationRoute = defineRoute({
  method: 'POST',
  path: '/:conversationId/stop',
  description:
    'Stop the reply being written. The partial message stays on the timeline. Does nothing when no turn is running.',
  schema: {
    params: z.object({conversationId: z.string().uuid()}),
    response: {
      204: z.void(),
    },
  },
  handler: async (request, reply) => {
    const conversation = await requireWebConversation(request, request.params.conversationId);

    await requestTurnStop(conversation.id);

    reply.code(204);
  },
});
