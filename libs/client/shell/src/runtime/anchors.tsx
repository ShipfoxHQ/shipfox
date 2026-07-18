import {ShipfoxLoader} from '@shipfox/react-ui/loader';
import {createRootRouteWithContext, createRoute, Outlet, redirect} from '@tanstack/react-router';
import {MainLayout} from '#components/main-layout.js';
import {NotFoundPage} from '#components/not-found-page.js';
import {SettingsNav} from '#components/settings-nav.js';
import type {NavTabEntry, SettingsSectionEntry} from '#contract.js';
import {anchorPaths} from './anchor-paths.js';
import {useChrome} from './chrome-context.js';
import {rememberLastWorkspaceId} from './last-workspace.js';
import type {RouterContext} from './router-context.js';
import {WorkspaceLayoutErrorRoute, WorkspaceSetupPending} from './workspace-setup.js';

export {routePathForAnchor} from './anchor-paths.js';

export function buildAnchorSkeleton({
  navigation,
  settingsSections,
}: {
  navigation: readonly NavTabEntry[];
  settingsSections: readonly SettingsSectionEntry[];
}) {
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: Outlet,
    notFoundComponent: NotFoundPage,
  });
  const workspaceLayout = createRoute({
    getParentRoute: () => rootRoute,
    path: anchorPaths.workspaceLayout,
    beforeLoad: async ({context, params, location}) => {
      try {
        rememberLastWorkspaceId(params.wid);
      } catch {
        // Local storage is best effort.
      }
      const auth = context.auth;
      if (!auth || auth.isLoading || !context.queryClient) return;
      if (!auth.isAuthenticated)
        throw redirect({to: '/auth/login' as never, search: {redirect: location.href} as never});
      if (!auth.workspaces.some((workspace) => workspace.id === params.wid))
        throw redirect({to: '/'});
      if (!context.workspaceSetup)
        throw new Error('Client composition includes workspace routes but no workspaceSetup gate.');
      return await context.workspaceSetup({
        queryClient: context.queryClient,
        workspaceId: params.wid,
        pathname: location.pathname,
      });
    },
    pendingComponent: () => (
      <div className="flex h-screen items-center justify-center">
        <ShipfoxLoader size={64} animation="circular" color="orange" background="dark" />
      </div>
    ),
    errorComponent: WorkspaceLayoutErrorRoute,
    component: () => {
      const setupState = workspaceLayout.useRouteContext() as {hideProjectNavigation?: boolean};
      return setupState.hideProjectNavigation === undefined ? (
        <WorkspaceSetupPending />
      ) : (
        <MainLayout
          navigation={navigation}
          hideProjectNavigation={setupState.hideProjectNavigation}
        />
      );
    },
  });
  const projectLayout = createRoute({
    getParentRoute: () => workspaceLayout,
    path: '/projects/$pid',
    component: () => {
      const {ProjectLayoutGuard} = useChrome();
      return <ProjectLayoutGuard />;
    },
  });
  const workspaceSettings = createRoute({
    getParentRoute: () => workspaceLayout,
    path: '/settings',
    component: () => (
      <>
        <SettingsNav entries={settingsSections} />
        <Outlet />
      </>
    ),
  });
  return {
    anchors: {root: rootRoute, workspaceLayout, projectLayout, workspaceSettings},
    rootRoute,
    workspaceLayout,
    projectLayout,
    workspaceSettings,
  };
}
