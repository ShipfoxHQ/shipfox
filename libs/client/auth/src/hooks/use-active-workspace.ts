import {useParams} from '@tanstack/react-router';
import type {Workspace} from '#state/auth.js';
import {useAuthState} from './use-auth-state.js';

/**
 * Returns the active workspace inferred from the URL `wid` param.
 *
 * Throws if no workspace matches — this hook assumes the caller is rendered
 * inside the `/workspaces/$wid` route subtree, where the layout's `beforeLoad`
 * has already validated `wid` against `auth.workspaces`. Calling it outside
 * that subtree is a developer error.
 */
export function useActiveWorkspace(): Workspace {
  const ws = useMaybeActiveWorkspace();
  if (!ws) {
    throw new Error('useActiveWorkspace called outside a /workspaces/$wid route');
  }
  return ws;
}

/**
 * Returns the active workspace if one is identifiable from the URL, else
 * `undefined`. Use at boundaries (root index, setup pages) where there may be
 * no `wid` param yet.
 */
export function useMaybeActiveWorkspace(): Workspace | undefined {
  const params = useParams({strict: false}) as {wid?: string};
  const {workspaces} = useAuthState();
  if (!params.wid) return undefined;
  return workspaces.find((w) => w.id === params.wid);
}
