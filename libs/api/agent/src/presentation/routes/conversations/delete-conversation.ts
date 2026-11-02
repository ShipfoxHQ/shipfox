import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {deleteWebConversation} from '#core/conversations.js';
import {requireWebConversation, translateConversationRouteError} from './access.js';

export const deleteConversationRoute = defineRoute({
  method: 'DELETE',
  path: '/:conversationId',
  description: 'Delete a conversation. Refused while a turn is running.',
  schema: {
    params: z.object({conversationId: z.string().uuid()}),
    response: {
      204: z.void(),
    },
  },
  errorHandler: translateConversationRouteError,
  handler: async (request, reply) => {
    const conversation = await requireWebConversation(request, request.params.conversationId);

    await deleteWebConversation(conversation.id);

    reply.code(204);
  },
});
