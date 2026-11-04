import {conversationDetailDtoSchema} from '@shipfox/api-agent-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listActiveRuns} from '#core/active-runs.js';
import {getOpenConversation} from '#core/conversations.js';
import type {RunDeliveryWorkflows} from '#core/deliver-run-results.js';
import {getLatestTurn} from '#db/conversations.js';
import {
  toConversationActiveRunDto,
  toConversationActiveTurnDto,
  toConversationLatestTurnDto,
  toConversationSummaryDto,
} from '#presentation/dto/conversation.js';
import {requireWebConversation, translateConversationRouteError} from './access.js';

/** Without a workflows client, this route can't read a conversation's runs, so it reports none. */
export function createGetConversationRoute(workflows: RunDeliveryWorkflows | undefined) {
  return defineRoute({
    method: 'GET',
    path: '/:conversationId',
    description: 'Get a conversation, its active turn, its latest turn, and its active runs.',
    schema: {
      params: z.object({conversationId: z.string().uuid()}),
      response: {
        200: conversationDetailDtoSchema,
      },
    },
    errorHandler: translateConversationRouteError,
    handler: async (request) => {
      const conversation = await requireWebConversation(request, request.params.conversationId);
      const [open, latestTurn, activeRuns] = await Promise.all([
        getOpenConversation(conversation),
        getLatestTurn(conversation.id),
        workflows === undefined
          ? []
          : listActiveRuns({
              workspaceId: conversation.workspaceId,
              conversationId: conversation.id,
              workflows,
            }),
      ]);

      // One running turn at most, and it is always the latest one.
      return {
        ...toConversationSummaryDto(open),
        active_turn:
          latestTurn?.status === 'running' ? toConversationActiveTurnDto(latestTurn) : null,
        latest_turn: latestTurn ? toConversationLatestTurnDto(latestTurn) : null,
        active_runs: activeRuns.map(toConversationActiveRunDto),
      };
    },
  });
}
