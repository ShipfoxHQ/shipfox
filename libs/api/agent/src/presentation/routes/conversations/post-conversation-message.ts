import {conversationItemDtoSchema, postConversationMessageBodySchema} from '@shipfox/api-agent-dto';
import {requireUserContext} from '@shipfox/api-auth-context';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {postWebConversationMessage} from '#core/conversations.js';
import {toConversationItemDto} from '#presentation/dto/conversation.js';
import {
  requireConversationAgent,
  requireWebConversation,
  translateConversationRouteError,
} from './access.js';
import type {WakeConversation} from './index.js';

export function createPostConversationMessageRoute(params: {
  definitions: DefinitionsInterModuleClient | undefined;
  wake: WakeConversation;
}) {
  const {definitions, wake} = params;
  return defineRoute({
    method: 'POST',
    path: '/:conversationId/messages',
    description: 'Queue a message in a conversation.',
    schema: {
      params: z.object({conversationId: z.string().uuid()}),
      body: postConversationMessageBodySchema,
      response: {
        201: conversationItemDtoSchema,
      },
    },
    errorHandler: translateConversationRouteError,
    handler: async (request, reply) => {
      const {client_message_id: clientMessageId, body, page_context: pageContext} = request.body;
      const conversation = await requireWebConversation(request, request.params.conversationId);
      await requireConversationAgent(conversation, definitions);

      const item = await postWebConversationMessage({
        conversation,
        authorUserId: requireUserContext(request).userId,
        clientMessageId,
        body,
        pageContext,
      });

      await wake(conversation.id);

      reply.code(201);
      return toConversationItemDto(item);
    },
  });
}
