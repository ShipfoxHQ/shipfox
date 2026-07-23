import {ApiError, configureApiClient} from '@shipfox/client-api';
import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {atom, useAtomValue, useSetAtom, useStore} from 'jotai';
import type {PropsWithChildren} from 'react';
import {useCallback, useEffect, useMemo} from 'react';
import type {AuthenticatedSession, UserIdentity, WorkspaceSummary} from '#core/session.js';
import {
  authRefreshQueryKey,
  authRefreshQueryOptions,
  userWorkspacesQueryOptions,
} from '#hooks/api/session-auth.js';
import {lastWorkspaceIdAtom} from './last-workspace.js';

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const REFRESH_RETRY_DELAY_MS = 60_000;
const BASE64_URL_REPLACEMENTS = {dash: /-/g, underscore: /_/g} as const;
const refreshPromises = new WeakMap<QueryClient, Promise<AuthenticatedSession>>();

function invalidateRefresh(queryClient: QueryClient): void {
  refreshPromises.delete(queryClient);
}

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

export type Workspace = WorkspaceSummary;

export interface AuthState {
  status: AuthStatus;
  token?: string;
  user?: UserIdentity;
  workspaces?: Workspace[];
}

export interface AuthStateValue extends AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  workspaces: Workspace[];
  hasWorkspace: boolean;
}

export const initialAuthState: AuthState = {status: 'loading'};
export const authStateAtom = atom<AuthState>(initialAuthState);
const authTransitionEpochAtom = atom(0);

export function toAuthenticatedState(
  session: AuthenticatedSession,
  workspaces: WorkspaceSummary[] = [],
): AuthState {
  return {
    status: 'authenticated',
    token: session.accessToken,
    user: session.user,
    workspaces,
  };
}

export function useAuthState(): AuthStateValue {
  const state = useAtomValue(authStateAtom);
  return useMemo(
    () => ({
      ...state,
      workspaces: state.workspaces ?? [],
      isLoading: state.status === 'loading',
      isAuthenticated: state.status === 'authenticated',
      hasWorkspace: (state.workspaces ?? []).length > 0,
    }),
    [state],
  );
}

export {
  authRefreshQueryKey,
  authRefreshQueryOptions,
  listUserWorkspaces,
  userWorkspacesQueryKey,
  userWorkspacesQueryOptions,
} from '#hooks/api/session-auth.js';

function decodeBase64Url(value: string): string {
  const base64 = value
    .replace(BASE64_URL_REPLACEMENTS.dash, '+')
    .replace(BASE64_URL_REPLACEMENTS.underscore, '/');
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
}

function readJwtExp(token: string): number | undefined {
  const [, payload] = token.split('.');
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as {exp?: unknown};
    return typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) ? parsed.exp : undefined;
  } catch {
    return undefined;
  }
}

export function getAuthRefreshDelayMs(token: string, nowMs = Date.now()): number | undefined {
  const exp = readJwtExp(token);
  return exp === undefined ? undefined : exp * 1000 - nowMs - REFRESH_EARLY_MS;
}

export function useAuthTransition() {
  const queryClient = useQueryClient();
  const store = useStore();
  const setState = useSetAtom(authStateAtom);
  const setLastWorkspaceId = useSetAtom(lastWorkspaceIdAtom);

  const beginAuthTransition = useCallback(() => {
    const transitionEpoch = store.get(authTransitionEpochAtom) + 1;
    store.set(authTransitionEpochAtom, transitionEpoch);
    return transitionEpoch;
  }, [store]);

  const clearPrivateState = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  const enterGuest = useCallback(
    async (transitionEpoch?: number) => {
      const isExternalTransition = transitionEpoch === undefined;
      const epoch = transitionEpoch ?? beginAuthTransition();
      if (isExternalTransition) invalidateRefresh(queryClient);
      if (store.get(authTransitionEpochAtom) !== epoch) return false;

      await clearPrivateState();
      if (store.get(authTransitionEpochAtom) !== epoch) return false;
      setLastWorkspaceId(undefined);
      setState({status: 'guest'});
      return true;
    },
    [beginAuthTransition, clearPrivateState, queryClient, setLastWorkspaceId, setState, store],
  );

  const enterAuthenticated = useCallback(
    async (session: AuthenticatedSession, transitionEpoch?: number) => {
      const isExternalTransition = transitionEpoch === undefined;
      const epoch = transitionEpoch ?? beginAuthTransition();
      if (isExternalTransition) invalidateRefresh(queryClient);
      if (store.get(authTransitionEpochAtom) !== epoch) return false;

      const previousState = store.get(authStateAtom);
      const principalChanged =
        previousState.status !== 'authenticated' || previousState.user?.id !== session.user.id;

      if (principalChanged) await clearPrivateState();
      if (store.get(authTransitionEpochAtom) !== epoch) return false;
      if (principalChanged) setLastWorkspaceId(undefined);

      queryClient.setQueryData(authRefreshQueryKey, session);
      let workspaces: WorkspaceSummary[] = [];
      try {
        const hydratedWorkspaces = await queryClient.fetchQuery(
          userWorkspacesQueryOptions(session.accessToken),
        );
        workspaces = hydratedWorkspaces.memberships;
      } catch {
        // The authenticated session remains usable while workspace hydration retries on the next route load.
      }
      if (store.get(authTransitionEpochAtom) !== epoch) return false;

      setState(toAuthenticatedState(session, workspaces));
      return true;
    },
    [beginAuthTransition, clearPrivateState, queryClient, setLastWorkspaceId, setState, store],
  );

  return {beginAuthTransition, enterAuthenticated, enterGuest};
}

export function useRefreshAuth() {
  const queryClient = useQueryClient();
  const {beginAuthTransition, enterAuthenticated, enterGuest} = useAuthTransition();

  return useCallback(() => {
    const existingRefresh = refreshPromises.get(queryClient);
    if (existingRefresh) return existingRefresh;

    const transitionEpoch = beginAuthTransition();
    const refresh = (async () => {
      try {
        const result = await queryClient.fetchQuery(authRefreshQueryOptions());
        const accepted = await enterAuthenticated(result, transitionEpoch);
        if (!accepted) {
          throw new ApiError({
            message: 'Authentication refresh was superseded.',
            code: 'unauthorized',
            status: 401,
          });
        }
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await enterGuest(transitionEpoch);
        }
        throw error;
      }
    })();
    refreshPromises.set(queryClient, refresh);
    void refresh.then(
      () => {
        if (refreshPromises.get(queryClient) === refresh) refreshPromises.delete(queryClient);
      },
      () => {
        if (refreshPromises.get(queryClient) === refresh) refreshPromises.delete(queryClient);
      },
    );
    return refresh;
  }, [beginAuthTransition, enterAuthenticated, enterGuest, queryClient]);
}

export interface AuthRuntimeProps extends PropsWithChildren {
  effects?: boolean;
}

export function AuthRuntime({children, effects = true}: AuthRuntimeProps) {
  const store = useStore();
  const authState = useAtomValue(authStateAtom);
  const refreshAuth = useRefreshAuth();

  useEffect(() => {
    if (!effects) return;
    configureApiClient({
      getAccessToken: () => store.get(authStateAtom).token,
      refreshAccessToken: async () => (await refreshAuth()).accessToken,
    });
  }, [effects, refreshAuth, store]);

  useEffect(() => {
    if (!effects) return;
    refreshAuth().catch(() => undefined);
  }, [effects, refreshAuth]);

  useEffect(() => {
    if (!effects || authState.status !== 'authenticated' || !authState.token) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let refreshing = false;
    const clearRefreshTimer = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
    };
    const scheduleRefresh = (delayMs: number) => {
      clearRefreshTimer();
      timeout = setTimeout(runRefresh, Math.max(0, delayMs));
    };
    const retryIfStillDue = () => {
      const current = store.get(authStateAtom);
      if (current.status !== 'authenticated' || !current.token) return;
      const delay = getAuthRefreshDelayMs(current.token);
      if (delay !== undefined && delay <= 0) scheduleRefresh(REFRESH_RETRY_DELAY_MS);
    };
    function runRefresh() {
      if (disposed || refreshing) return;
      refreshing = true;
      clearRefreshTimer();
      refreshAuth()
        .catch(() => undefined)
        .finally(() => {
          refreshing = false;
          if (!disposed) retryIfStillDue();
        });
    }
    const refreshIfDue = () => {
      const current = store.get(authStateAtom);
      if (current.status !== 'authenticated' || !current.token) return;
      const delay = getAuthRefreshDelayMs(current.token);
      if (delay !== undefined && delay <= 0) runRefresh();
    };
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') refreshIfDue();
    };
    const delay = getAuthRefreshDelayMs(authState.token);
    if (delay !== undefined) scheduleRefresh(delay);
    window.addEventListener('focus', refreshIfDue);
    window.addEventListener('online', refreshIfDue);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      disposed = true;
      clearRefreshTimer();
      window.removeEventListener('focus', refreshIfDue);
      window.removeEventListener('online', refreshIfDue);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [authState.status, authState.token, effects, refreshAuth, store]);

  return children;
}
