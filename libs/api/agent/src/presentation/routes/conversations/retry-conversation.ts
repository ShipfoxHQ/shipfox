import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {requestWebConversationRetry} from '#core/conversations.js';
import {requireWebConversation, translateConversationRouteError} from './access.js';
import type {WakeConversation} from './index.js';

export function createRetryConversationRoute(wake: WakeConversation) {
  return defineRoute({
    method: 'POST',
    path: '/:conversationId/retry',
    description: 'Run the latest turn again. Valid when it failed or was denied.',
    schema: {
      params: z.object({conversationId: z.string().uuid()}),
      response: {
        204: z.void(),
      },
    },
    errorHandler: translateConversationRouteError,
    handler: async (request, reply) => {
      const conversation = await requireWebConversation(request, request.params.conversationId);

      await requestWebConversationRetry(conversation.id);
      await wake(conversation.id);

      reply.code(204);
    },
  });
}
