import {MainLayout} from '@shipfox/client-app-shell';
import {rememberLastWorkspaceId} from '@shipfox/client-auth';
import {
  loadWorkspaceSetupRoute,
  WorkspaceSetupErrorRoute,
  WorkspaceSetupPending,
} from '@shipfox/client-projects';
import {ShipfoxLoader} from '@shipfox/react-ui';
import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout')({
  beforeLoad: async ({context, params, location}) => {
    const auth = context.auth;
    if (!auth || auth.isLoading || !context.queryClient) return;
    if (!auth.isAuthenticated) {
      throw redirect({to: '/auth/login', search: {redirect: location.href}});
    }
    if (!auth.workspaces.some((w) => w.id === params.wid)) {
      throw redirect({to: '/'});
    }
    try {
      rememberLastWorkspaceId(params.wid);
    } catch {
      // localStorage may throw in private browsing or quota-exceeded; routing is still URL-driven.
    }
    return await loadWorkspaceSetupRoute({
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
  errorComponent: WorkspaceSetupErrorRoute,
  component: WorkspaceLayoutRoute,
});

function WorkspaceLayoutRoute() {
  const setupState = Route.useRouteContext();
  if (setupState.hideProjectNavigation === undefined) return <WorkspaceSetupPending />;

  return <MainLayout hideProjectNavigation={setupState.hideProjectNavigation} />;
}
