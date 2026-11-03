import {conversationDetailDtoSchema} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {getOpenConversation} from '#core/conversations.js';
import {getLatestTurn} from '#db/conversations.js';
import {
  toConversationActiveTurnDto,
  toConversationLatestTurnDto,
  toConversationSummaryDto,
} from '#presentation/dto/conversation.js';
import {requireWebConversation, translateConversationRouteError} from './access.js';

export const getConversationRoute = defineRoute({
  method: 'GET',
  path: '/:conversationId',
  description: 'Get a conversation, its active turn, and its latest turn.',
  schema: {
    params: z.object({conversationId: z.string().uuid()}),
    response: {
      200: conversationDetailDtoSchema,
    },
  },
  errorHandler: translateConversationRouteError,
  handler: async (request) => {
    const conversation = await requireWebConversation(request, request.params.conversationId);
    const [open, latestTurn] = await Promise.all([
      getOpenConversation(conversation),
      getLatestTurn(conversation.id),
    ]);

    // One running turn at most, and it is always the latest one.
    return {
      ...toConversationSummaryDto(open),
      active_turn:
        latestTurn?.status === 'running' ? toConversationActiveTurnDto(latestTurn) : null,
      latest_turn: latestTurn ? toConversationLatestTurnDto(latestTurn) : null,
    };
  },
});
