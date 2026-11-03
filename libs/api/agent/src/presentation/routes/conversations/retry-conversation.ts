import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {requestWebConversationRetry} from '#core/conversations.js';
import {
  requireConversationAgent,
  requireWebConversation,
  translateConversationRouteError,
} from './access.js';
import type {WakeConversation} from './index.js';

export function createRetryConversationRoute(params: {
  definitions: DefinitionsInterModuleClient | undefined;
  wake: WakeConversation;
}) {
  const {definitions, wake} = params;
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
      await requireConversationAgent(conversation, definitions);

      await requestWebConversationRetry(conversation.id);
      await wake(conversation.id);

      reply.code(204);
    },
  });
}
