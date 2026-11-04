import {AUTH_USER} from '@shipfox/api-auth-context';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import type {RunDeliveryWorkflows} from '#core/deliver-run-results.js';
import {createCreateConversationRoute} from './create-conversation.js';
import {deleteConversationRoute} from './delete-conversation.js';
import {createGetConversationRoute} from './get-conversation.js';
import {listConversationItemsRoute} from './list-conversation-items.js';
import {createListConversationsRoute} from './list-conversations.js';
import {createListProjectAgentsRoute} from './list-project-agents.js';
import {markConversationReadRoute} from './mark-conversation-read.js';
import {createPostConversationMessageRoute} from './post-conversation-message.js';
import {createRetryConversationRoute} from './retry-conversation.js';
import {stopConversationRoute} from './stop-conversation.js';
import {streamConversationRoute} from './stream-conversation.js';

/** Tells a conversation's workflow to look at its inputs again. See `wakeConversation`. */
export type WakeConversation = (conversationId: string) => Promise<void>;

export function createConversationRoutes(params: {
  projects: ProjectsModuleClient;
  /** Reads the runs a conversation started. Without it, a conversation has no active runs. */
  workflows: RunDeliveryWorkflows | undefined;
  /** Serves the project's agent files. Without it, the built-in agent is the only one. */
  definitions: DefinitionsInterModuleClient | undefined;
  wake: WakeConversation;
}): RouteGroup[] {
  const {projects, definitions, wake, workflows} = params;
  return [
    {
      prefix: '/projects/:projectId/agents',
      auth: AUTH_USER,
      routes: [createListProjectAgentsRoute({projects, definitions})],
    },
    {
      prefix: '/projects/:projectId/conversations',
      auth: AUTH_USER,
      routes: [
        createListConversationsRoute(projects),
        createCreateConversationRoute({projects, definitions, wake}),
      ],
    },
    {
      prefix: '/conversations',
      auth: AUTH_USER,
      routes: [
        createGetConversationRoute(workflows),
        listConversationItemsRoute,
        streamConversationRoute,
        createPostConversationMessageRoute({definitions, wake}),
        markConversationReadRoute,
        stopConversationRoute,
        createRetryConversationRoute({definitions, wake}),
        deleteConversationRoute,
      ],
    },
  ];
}
