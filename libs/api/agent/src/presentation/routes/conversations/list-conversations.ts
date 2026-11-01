import {
  listConversationsQuerySchema,
  listConversationsResponseSchema,
} from '@shipfox/api-agent-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {decodeTimestampIdCursor, encodeTimestampIdCursor} from '@shipfox/node-drizzle';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {listOpenWebConversations} from '#core/conversations.js';
import {toConversationSummaryDto} from '#presentation/dto/conversation.js';
import {requireProjectAccess, translateConversationRouteError} from './access.js';

export function createListConversationsRoute(projects: ProjectsModuleClient) {
  return defineRoute({
    method: 'GET',
    path: '/',
    description: "List the caller's own web conversations in a project.",
    schema: {
      params: z.object({projectId: z.string().uuid()}),
      querystring: listConversationsQuerySchema,
      response: {
        200: listConversationsResponseSchema,
      },
    },
    errorHandler: translateConversationRouteError,
    handler: async (request) => {
      const {projectId} = request.params;
      const {limit, cursor} = request.query;
      const {workspaceId, userId} = await requireProjectAccess(request, projectId, projects);

      const decodedCursor = decodeTimestampIdCursor(cursor);
      if (cursor && !decodedCursor) {
        throw new ClientError('Invalid cursor', 'invalid-cursor', {status: 400});
      }

      const result = await listOpenWebConversations({
        workspaceId,
        projectId,
        ownerUserId: userId,
        limit,
        cursor: decodedCursor,
      });

      return {
        conversations: result.conversations.map(toConversationSummaryDto),
        next_cursor: result.nextCursor ? encodeTimestampIdCursor(result.nextCursor) : null,
        unread_count: result.unreadCount,
      };
    },
  });
}
