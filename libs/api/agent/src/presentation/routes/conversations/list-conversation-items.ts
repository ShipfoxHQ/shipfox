import {
  listConversationItemsQuerySchema,
  listConversationItemsResponseSchema,
} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listOpenConversationItems} from '#core/conversations.js';
import {toConversationItemDto} from '#presentation/dto/conversation.js';
import {requireWebConversation, translateConversationRouteError} from './access.js';

export const listConversationItemsRoute = defineRoute({
  method: 'GET',
  path: '/:conversationId/items',
  description: 'Read conversation items after a seq, before one, or from the latest page.',
  schema: {
    params: z.object({conversationId: z.string().uuid()}),
    querystring: listConversationItemsQuerySchema,
    response: {
      200: listConversationItemsResponseSchema,
    },
  },
  errorHandler: translateConversationRouteError,
  handler: async (request) => {
    const {after_seq: afterSeq, before_seq: beforeSeq, limit} = request.query;
    const conversation = await requireWebConversation(request, request.params.conversationId);

    const result = await listOpenConversationItems({conversation, afterSeq, beforeSeq, limit});

    return {
      items: result.items.map(toConversationItemDto),
      queued: result.queued.map(toConversationItemDto),
      queued_has_more: result.queuedHasMore,
      has_more: result.hasMore,
    };
  },
});
