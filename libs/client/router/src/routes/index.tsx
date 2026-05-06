import {lastWorkspaceIdAtom} from '@shipfox/client-auth';
import {FullPageLoader} from '@shipfox/react-ui';
import {createFileRoute, redirect} from '@tanstack/react-router';
import {getDefaultStore} from 'jotai';

export const Route = createFileRoute('/')({
  beforeLoad: ({context}) => {
    const auth = context.auth;
    // While auth is still resolving on first paint, fall through to the
    // FullPageLoader component. The route re-evaluates when context.auth
    // updates and the redirect fires below.
    if (!auth || auth.isLoading) return;
    if (!auth.isAuthenticated) throw redirect({to: '/auth/login'});
    const [first, ...rest] = auth.workspaces;
    if (!first) throw redirect({to: '/setup/workspaces/new'});
    const lastId = getDefaultStore().get(lastWorkspaceIdAtom);
    const all = [first, ...rest];
    const target = all.find((w) => w.id === lastId)?.id ?? first.id;
    throw redirect({to: '/workspaces/$wid', params: {wid: target}});
  },
  component: FullPageLoader,
});
