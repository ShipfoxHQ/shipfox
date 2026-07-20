import cookie from '@fastify/cookie';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import type {RouteGroup} from '@shipfox/node-fastify';
import {createE2eSessionRoute} from './create-session.js';
import {createE2eUserRoute} from './create-user.js';

export function createAuthE2eRoutes(workspaces: WorkspacesInterModuleClient): RouteGroup {
  return {
    prefix: '/auth',
    plugins: [cookie],
    routes: [createE2eUserRoute, createE2eSessionRoute(workspaces)],
  };
}
