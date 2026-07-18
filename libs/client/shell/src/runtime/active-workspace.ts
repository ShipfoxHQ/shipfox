import {useParams} from '@tanstack/react-router';
import {useAuthState, type Workspace} from './auth.js';

export function useActiveWorkspace(): Workspace {
  const workspace = useMaybeActiveWorkspace();
  if (!workspace) throw new Error('useActiveWorkspace called outside a /workspaces/$wid route');
  return workspace;
}

export function useMaybeActiveWorkspace(): Workspace | undefined {
  const {wid} = useParams({strict: false}) as {wid?: string};
  return useAuthState().workspaces.find((workspace) => workspace.id === wid);
}
