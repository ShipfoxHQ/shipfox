import {lastWorkspaceIdAtom} from '@shipfox/client-auth';
import {createFileRoute, redirect} from '@tanstack/react-router';
import {getDefaultStore} from 'jotai';

export const Route = createFileRoute('/')({
  beforeLoad: ({context}) => {
    const auth = context.auth;
    if (!auth || auth.isLoading) return;
    if (!auth.isAuthenticated) throw redirect({to: '/auth/login'});
    const [first, ...rest] = auth.workspaces;
    if (!first) throw redirect({to: '/setup/workspaces/new'});
    const lastId = getDefaultStore().get(lastWorkspaceIdAtom);
    const all = [first, ...rest];
    const target = all.find((w) => w.id === lastId)?.id ?? first.id;
    throw redirect({to: '/workspaces/$wid', params: {wid: target}});
  },
});
