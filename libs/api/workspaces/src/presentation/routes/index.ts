import type {RouteGroup} from '@shipfox/node-fastify';
import {invitationsAcceptGroup, invitationsWorkspaceScopedRoutes} from './invitations/index.js';
import {memberRoutes} from './members/index.js';
import {createWorkspaceRoute, listUserWorkspacesRoute} from './workspaces/index.js';

export const workspacesRoutes: RouteGroup[] = [
  invitationsAcceptGroup,
  {
    prefix: '/workspaces',
    routes: [
      listUserWorkspacesRoute,
      createWorkspaceRoute,
      {
        prefix: '/:workspaceId/members',
        routes: memberRoutes,
      },
      {
        prefix: '/:workspaceId/invitations',
        routes: invitationsWorkspaceScopedRoutes,
      },
    ],
  },
];
