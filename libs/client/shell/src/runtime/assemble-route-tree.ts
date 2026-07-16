import {createRoute} from '@tanstack/react-router';
import type {ComposedRoute} from '#compose/compose-routes.js';
import {buildAnchorSkeleton, routePathForAnchor} from '#runtime/anchors.js';
import type {RouteImpl} from '#runtime/define-route.js';

export type ResolveRouteImpl = (specifier: string) => RouteImpl | Promise<RouteImpl>;

export async function assembleRouteTree(
  routes: readonly ComposedRoute[],
  options: {
    resolveImpl: ResolveRouteImpl;
    navigation: Parameters<typeof buildAnchorSkeleton>[0]['navigation'];
    settingsSections: Parameters<typeof buildAnchorSkeleton>[0]['settingsSections'];
  },
) {
  const skeleton = buildAnchorSkeleton(options);
  const children = await Promise.all(
    routes.map(async (route) => {
      const impl = await options.resolveImpl(route.impl);
      return {
        parent: route.parent,
        route: createRoute({
          getParentRoute: () => skeleton.anchors[route.parent] as never,
          path: routePathForAnchor(route.parent, route.path),
          ...impl.options,
        } as never),
      };
    }),
  );
  const childrenFor = (anchor: keyof typeof skeleton.anchors) =>
    children.filter((child) => child.parent === anchor).map((child) => child.route);
  const projectLayout = skeleton.projectLayout.addChildren(childrenFor('projectLayout'));
  const workspaceSettings = skeleton.workspaceSettings.addChildren(
    childrenFor('workspaceSettings'),
  );
  const workspaceLayout = skeleton.workspaceLayout.addChildren([
    ...childrenFor('workspaceLayout'),
    projectLayout,
    workspaceSettings,
  ]);
  return skeleton.rootRoute.addChildren([...childrenFor('root'), workspaceLayout]);
}
