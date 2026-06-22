import {LimitedLayout} from '@shipfox/client-app-shell';
import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/setup/_layout')({
  beforeLoad: ({context, location}) => {
    const auth = context.auth;
    if (!auth || auth.isLoading) return;
    if (!auth.isAuthenticated) {
      throw redirect({to: '/auth/login', search: {redirect: location.href}});
    }
    if (auth.workspaces.length === 0 && !location.pathname.startsWith('/setup/workspaces/new')) {
      throw redirect({to: '/setup/workspaces/new'});
    }
  },
  component: LimitedLayout,
});
