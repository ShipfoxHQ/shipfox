import {
  createConversationBodySchema,
  createConversationResponseSchema,
} from '@shipfox/api-agent-dto';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {createWebConversation} from '#core/conversations.js';
import {resolveProjectAgent} from '#core/project-agents.js';
import {toConversationItemDto, toConversationSummaryDto} from '#presentation/dto/conversation.js';
import {requireProjectAccess, translateConversationRouteError} from './access.js';
import type {WakeConversation} from './index.js';

export function createCreateConversationRoute(params: {
  projects: ProjectsModuleClient;
  definitions: DefinitionsInterModuleClient | undefined;
  wake: WakeConversation;
}) {
  const {projects, definitions, wake} = params;
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
      const {
        client_message_id: clientMessageId,
        body,
        page_context: pageContext,
        agent_key: agentKey,
      } = request.body;
      const {workspaceId, userId} = await requireProjectAccess(request, projectId, projects);
      if (agentKey !== undefined) {
        await resolveProjectAgent({definitions, workspaceId, projectId, key: agentKey});
      }

      const {conversation, item} = await createWebConversation({
        workspaceId,
        projectId,
        ownerUserId: userId,
        agentKey,
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
