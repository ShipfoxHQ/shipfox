import {conversationDetailDtoSchema} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getOpenConversation} from '#core/conversations.js';
import {getRunningTurn} from '#db/conversations.js';
import {
  toConversationActiveTurnDto,
  toConversationSummaryDto,
} from '#presentation/dto/conversation.js';
import {requireWebConversation, translateConversationRouteError} from './access.js';

export const getConversationRoute = defineRoute({
  method: 'GET',
  path: '/:conversationId',
  description: 'Get a conversation and its active turn.',
  schema: {
    params: z.object({conversationId: z.string().uuid()}),
    response: {
      200: conversationDetailDtoSchema,
    },
  },
  errorHandler: translateConversationRouteError,
  handler: async (request) => {
    const conversation = await requireWebConversation(request, request.params.conversationId);
    const [open, activeTurn] = await Promise.all([
      getOpenConversation(conversation),
      getRunningTurn(conversation.id),
    ]);

    return {
      ...toConversationSummaryDto(open),
      active_turn: activeTurn ? toConversationActiveTurnDto(activeTurn) : null,
    };
  },
});
