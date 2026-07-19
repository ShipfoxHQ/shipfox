import {buildAnchorSkeleton, type RouterContext} from '@shipfox/client-shell/runtime';
import {createRoute, createRouter} from '@tanstack/react-router';
import agentsRoute from '#routes/agents.js';
import eventsRoute from '#routes/events.js';
import indexRoute from '#routes/index.js';
import integrationsRoute from '#routes/integrations.js';
import membersRoute from '#routes/members.js';
import provisionersRoute from '#routes/provisioners.js';
import runnersRoute from '#routes/runners.js';
import secretsRoute from '#routes/secrets.js';
import variablesRoute from '#routes/variables.js';

const skeleton = buildAnchorSkeleton({navigation: [], settingsSections: []});

const settingsIndexRoute = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/',
  ...indexRoute.options,
});

const membersRouteNode = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/members',
  ...membersRoute.options,
});

const runnersRouteNode = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/runners',
  ...runnersRoute.options,
});

const provisionersRouteNode = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/provisioners',
  ...provisionersRoute.options,
});

const agentsRouteNode = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/agents',
  ...agentsRoute.options,
});

const secretsRouteNode = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/secrets',
  ...secretsRoute.options,
});

const variablesRouteNode = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/variables',
  ...variablesRoute.options,
});

const integrationsRouteNode = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/integrations',
  ...integrationsRoute.options,
});

const eventsRouteNode = createRoute({
  getParentRoute: () => skeleton.workspaceSettings,
  path: '/events',
  ...eventsRoute.options,
});

const workspaceSettings = skeleton.workspaceSettings.addChildren([
  settingsIndexRoute,
  membersRouteNode,
  runnersRouteNode,
  provisionersRouteNode,
  agentsRouteNode,
  secretsRouteNode,
  variablesRouteNode,
  integrationsRouteNode,
  eventsRouteNode,
]);

const workspaceLayout = skeleton.workspaceLayout.addChildren([workspaceSettings]);

const routeTree = skeleton.rootRoute.addChildren([workspaceLayout]);

export const router = createRouter({
  routeTree,
  context: {auth: undefined, queryClient: undefined} satisfies RouterContext,
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
