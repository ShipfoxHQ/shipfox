import {useAuthState, type Workspace} from './auth.js';
import {parseWorkspaceParams, useRouteParams} from './route-inputs.js';

export function useActiveWorkspace(): Workspace {
  const workspace = useMaybeActiveWorkspace();
  if (!workspace) throw new Error('useActiveWorkspace called outside a /workspaces/$wid route');
  return workspace;
}

export function useMaybeActiveWorkspace(): Workspace | undefined {
  const {wid} = useRouteParams(parseWorkspaceParams);
  return useAuthState().workspaces.find((workspace) => workspace.id === wid);
}
