import {
  createConversationBodySchema,
  createConversationResponseSchema,
} from '@shipfox/api-agent-dto';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {createWebConversation} from '#core/conversations.js';
import {toConversationItemDto, toConversationSummaryDto} from '#presentation/dto/conversation.js';
import {requireProjectAccess, translateConversationRouteError} from './access.js';
import type {WakeConversation} from './index.js';

export function createCreateConversationRoute(
  projects: ProjectsModuleClient,
  wake: WakeConversation,
) {
  return defineRoute({
    method: 'POST',
    path: '/',
    description: 'Create a private web conversation with its first message.',
    schema: {
      params: z.object({projectId: z.string().uuid()}),
      body: createConversationBodySchema,
      response: {
        201: createConversationResponseSchema,
      },
    },
    errorHandler: translateConversationRouteError,
    handler: async (request, reply) => {
      const {projectId} = request.params;
      const {client_message_id: clientMessageId, body, page_context: pageContext} = request.body;
      const {workspaceId, userId} = await requireProjectAccess(request, projectId, projects);

      const {conversation, item} = await createWebConversation({
        workspaceId,
        projectId,
        ownerUserId: userId,
        clientMessageId,
        body,
        pageContext,
      });

      await wake(conversation.id);

      reply.code(201);
      return {
        conversation: toConversationSummaryDto(conversation),
        item: toConversationItemDto(item),
      };
    },
  });
}
