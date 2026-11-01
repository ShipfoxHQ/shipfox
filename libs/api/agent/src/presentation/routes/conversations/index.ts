import {AUTH_USER} from '@shipfox/api-auth-context';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createCreateConversationRoute} from './create-conversation.js';
import {deleteConversationRoute} from './delete-conversation.js';
import {getConversationRoute} from './get-conversation.js';
import {listConversationItemsRoute} from './list-conversation-items.js';
import {createListConversationsRoute} from './list-conversations.js';
import {markConversationReadRoute} from './mark-conversation-read.js';
import {postConversationMessageRoute} from './post-conversation-message.js';

export function createConversationRoutes(projects: ProjectsModuleClient): RouteGroup[] {
  return [
    {
      prefix: '/projects/:projectId/conversations',
      auth: AUTH_USER,
      routes: [createListConversationsRoute(projects), createCreateConversationRoute(projects)],
    },
    {
      prefix: '/conversations',
      auth: AUTH_USER,
      routes: [
        getConversationRoute,
        listConversationItemsRoute,
        postConversationMessageRoute,
        markConversationReadRoute,
        deleteConversationRoute,
      ],
    },
  ];
}
