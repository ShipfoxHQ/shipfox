import {LimitedLayout} from '@shipfox/client-app-shell';
import {createFileRoute, redirect} from '@tanstack/react-router';

export const Route = createFileRoute('/setup/_layout')({
  beforeLoad: ({context, location}) => {
    const auth = context.auth;
    if (!auth || auth.isLoading) return;
    if (!auth.isAuthenticated) throw redirect({to: '/auth/login'});
    // If the user has no workspaces and they're not already on the workspace
    // creation page, send them there.
    if (auth.workspaces.length === 0 && !location.pathname.startsWith('/setup/workspaces/new')) {
      throw redirect({to: '/setup/workspaces/new'});
    }
  },
  component: LimitedLayout,
});
