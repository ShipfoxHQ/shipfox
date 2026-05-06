import {MainLayout} from '@shipfox/client-app-shell';
import {ShipfoxLoader} from '@shipfox/react-ui';
import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/workspaces/$wid/_layout')({
  beforeLoad: ({context, params}) => {
    const auth = context.auth;
    if (!auth || auth.isLoading) return;
    if (!auth.isAuthenticated) throw redirect({to: '/auth/login'});
    if (!auth.workspaces.some((w) => w.id === params.wid)) {
      throw redirect({to: '/'});
    }
  },
  pendingComponent: () => (
    <div className="flex h-screen items-center justify-center">
      <ShipfoxLoader size={64} animation="circular" color="orange" background="dark" />
    </div>
  ),
  component: MainLayout,
});
