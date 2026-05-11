import type {RouteGroup} from '@shipfox/node-fastify';
import {createE2eInvitationRoute} from './create-invitation.js';
import {createE2eWorkspaceRoute} from './create-workspace.js';

export const workspacesE2eRoutes: RouteGroup = {
  prefix: '/workspaces',
  routes: [createE2eWorkspaceRoute, createE2eInvitationRoute],
};
