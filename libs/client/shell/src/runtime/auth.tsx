import {loginResponseSchema} from '@shipfox/api-auth-dto';
import {listUserWorkspacesResponseSchema} from '@shipfox/api-workspaces-dto';
import {ApiError, checkedApiRequest, configureApiClient} from '@shipfox/client-api';
import {useQueryClient} from '@tanstack/react-query';
import {atom, useAtomValue, useSetAtom, useStore} from 'jotai';
import type {PropsWithChildren} from 'react';
import {useCallback, useEffect, useMemo} from 'react';
import type {AuthenticatedSession, UserIdentity, WorkspaceSummary} from '#core/session.js';
import {toAuthenticatedSession} from '#hooks/api/session-mapper.js';

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const REFRESH_RETRY_DELAY_MS = 60_000;
const BASE64_URL_REPLACEMENTS = {dash: /-/g, underscore: /_/g} as const;

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
export const authRefreshQueryKey = ['auth', 'refresh'] as const;
export const userWorkspacesQueryKey = ['workspaces', 'mine'] as const;

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

export async function listUserWorkspaces(token?: string) {
  const response = await checkedApiRequest(
    listUserWorkspacesResponseSchema,
    '/workspaces',
    token ? {headers: {authorization: `Bearer ${token}`}} : {},
  );
  return {
    memberships: response.memberships.map((membership) => ({
      id: membership.workspace_id,
      name: membership.workspace_name,
      membershipId: membership.id,
    })),
  };
}

async function refreshAuthRequest(): Promise<AuthenticatedSession> {
  const response = await checkedApiRequest(loginResponseSchema, '/auth/refresh', {method: 'POST'});
  return toAuthenticatedSession(response);
}

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

  const clearPrivateState = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

  const enterGuest = useCallback(async () => {
    const transitionEpoch = store.get(authTransitionEpochAtom) + 1;
    store.set(authTransitionEpochAtom, transitionEpoch);
    await clearPrivateState();
    if (store.get(authTransitionEpochAtom) !== transitionEpoch) return;
    setState({status: 'guest'});
  }, [clearPrivateState, setState, store]);

  const enterAuthenticated = useCallback(
    async (session: AuthenticatedSession) => {
      const transitionEpoch = store.get(authTransitionEpochAtom) + 1;
      store.set(authTransitionEpochAtom, transitionEpoch);
      const previousState = store.get(authStateAtom);
      const principalChanged =
        previousState.status === 'authenticated' && previousState.user?.id !== session.user.id;

      if (principalChanged) await clearPrivateState();
      if (store.get(authTransitionEpochAtom) !== transitionEpoch) return;

      queryClient.setQueryData(authRefreshQueryKey, session);
      let workspaces: WorkspaceSummary[] = [];
      try {
        const hydratedWorkspaces = await queryClient.fetchQuery({
          queryKey: userWorkspacesQueryKey,
          queryFn: () => listUserWorkspaces(session.accessToken),
          retry: false,
          staleTime: 0,
        });
        workspaces = hydratedWorkspaces.memberships;
        queryClient.setQueryData(userWorkspacesQueryKey, hydratedWorkspaces);
      } catch {
        // The authenticated session remains usable while workspace hydration retries on the next route load.
      }
      if (store.get(authTransitionEpochAtom) !== transitionEpoch) return;

      setState(toAuthenticatedState(session, workspaces));
    },
    [clearPrivateState, queryClient, setState, store],
  );

  return {enterAuthenticated, enterGuest};
}

export function useRefreshAuth() {
  const queryClient = useQueryClient();
  const {enterAuthenticated, enterGuest} = useAuthTransition();
  return useCallback(async () => {
    try {
      const result = await queryClient.fetchQuery({
        queryKey: authRefreshQueryKey,
        queryFn: refreshAuthRequest,
        retry: false,
        staleTime: 0,
      });
      await enterAuthenticated(result);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await enterGuest();
      throw error;
    }
  }, [enterAuthenticated, enterGuest, queryClient]);
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
