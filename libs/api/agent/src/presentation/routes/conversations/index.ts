import {AUTH_USER} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createCreateConversationRoute} from './create-conversation.js';
import {deleteConversationRoute} from './delete-conversation.js';
import {getConversationRoute} from './get-conversation.js';
import {listConversationItemsRoute} from './list-conversation-items.js';
import {createListConversationsRoute} from './list-conversations.js';
import {markConversationReadRoute} from './mark-conversation-read.js';
import {createPostConversationMessageRoute} from './post-conversation-message.js';

/** Tells a conversation's workflow to look at its inputs again. See `wakeConversation`. */
export type WakeConversation = (conversationId: string) => Promise<void>;

export function createConversationRoutes(
  projects: ProjectsModuleClient,
  wake: WakeConversation,
): RouteGroup[] {
  return [
    {
      prefix: '/projects/:projectId/conversations',
      auth: AUTH_USER,
      routes: [
        createListConversationsRoute(projects),
        createCreateConversationRoute(projects, wake),
      ],
    },
    {
      prefix: '/conversations',
      auth: AUTH_USER,
      routes: [
        getConversationRoute,
        listConversationItemsRoute,
        createPostConversationMessageRoute(wake),
        markConversationReadRoute,
        deleteConversationRoute,
      ],
    },
  ];
}
