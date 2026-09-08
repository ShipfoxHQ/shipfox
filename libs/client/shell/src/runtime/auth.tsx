import {
  type AdoptedSessionReleaseReason,
  ApiError,
  configureApiClient,
  createAdoptedSessionEndedError,
  createAdoptedSessionPausedError,
} from '@shipfox/client-api';
import {type QueryClient, useQueryClient} from '@tanstack/react-query';
import {atom, useAtomValue, useSetAtom, useStore} from 'jotai';
import type {PropsWithChildren, ReactNode} from 'react';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {AuthenticatedSession, UserIdentity, WorkspaceSummary} from '#core/session.js';
import {
  authRefreshQueryKey,
  authRefreshQueryOptions,
  snapshotAuthenticatedSession,
  userWorkspacesQueryOptions,
} from '#hooks/api/session-auth.js';
import {lastWorkspaceIdAtom} from './last-workspace.js';
import {isAdoptedSessionPausedError} from './query-client.js';

export {snapshotAuthenticatedSession};
export const getOrdinarySessionSnapshot = snapshotAuthenticatedSession;

const REFRESH_EARLY_MS = 5 * 60 * 1000;
const REFRESH_RETRY_DELAY_MS = 60_000;
const CONTINUATION_MIN_INTERVAL_MS = 5_000;
const CONTINUATION_RETRY_BASE_MS = 1_000;
const CONTINUATION_RETRY_MAX_MS = 60_000;
const CONTINUATION_STALL_LIMIT = 3;
const RETRY_AFTER_SECONDS_RE = /^\d+(?:\.\d+)?$/u;
const TERMINAL_CONTINUATION_CODES = new Set([
  'admin-role-required',
  'cannot-impersonate-administrator',
  'cannot-impersonate-self',
  'impersonation-disabled',
  'impersonation-expired',
  'impersonation-target-not-active',
  'impersonation-target-not-workspace-member',
  'impersonation-window-deadline-reached',
  'impersonation-window-not-found',
  'impersonation-window-stopped',
]);
// Consecutive renewal responses that do not advance the adopted window (a
// malformed response, or an expiry no later than the one already held) end
// the adoption instead of driving an unbounded zero-delay renew loop. A
// valid response that merely lost a race to a longer expiry is not one.
const ADOPTED_RENEWAL_STALL_LIMIT = 3;
const BASE64_URL_REPLACEMENTS = {dash: /-/g, underscore: /_/g} as const;
const refreshPromises = new WeakMap<QueryClient, Promise<AuthenticatedSession>>();

/**
 * A renewal response for an adopted session. `expiresAt` and `serverTime` are
 * both issuer timestamps; their difference is the server-side remaining
 * lifetime, which is the renewal scheduling anchor.
 */
export interface AdoptedSessionRenewal {
  session: AuthenticatedSession;
  expiresAt: string;
  serverTime: string;
}

export type AdoptedSessionContinuationSource =
  | 'timer'
  | 'request'
  | 'unauthorized'
  | 'manual'
  | 'boot';

export interface AdoptedSessionContinuationInput {
  signal?: AbortSignal | undefined;
  source?: AdoptedSessionContinuationSource;
}

/**
 * Supplies a replacement token. Existing suppliers that take no arguments
 * remain valid. A supplier must use cookie-only authentication or provide its
 * own explicit authorization header; calling the ambient configured transport
 * can re-enter the continuation currently waiting for the supplier.
 */
export type AdoptedSessionRenewalSupplier = (
  input?: AdoptedSessionContinuationInput,
) => Promise<AdoptedSessionRenewal | null>;

export type AdoptedSessionReleaseCallback = (
  reason: AdoptedSessionReleaseReason,
) => void | Promise<void>;

export type AdoptedSessionRenewalState = 'active' | 'paused' | 'recovering';

/** Options for an adopted session. Set `continuity` to enable bounded renewal. */
export interface AdoptSessionOptions {
  expiresAt: string;
  serverTime: string;
  renew?: AdoptedSessionRenewalSupplier;
  /** Frozen server deadline required for a continuity adoption. */
  hardDeadline?: string;
  continuity?: boolean;
  onRelease?: AdoptedSessionReleaseCallback;
}

/** The adopted session as exposed to composing consumers. */
export interface AdoptedSessionState {
  session: AuthenticatedSession;
  expiresAt: string;
  serverTime: string;
  hardDeadline?: string;
  renewalState: AdoptedSessionRenewalState;
  isRenewalPaused: boolean;
}

interface AdoptedSessionRuntimeState extends AdoptedSessionState {
  generation: number;
  receivedAtMs: number;
  observedLifetimeMs: number;
  tokenExpiresAtMs: number;
  hardDeadlineMs?: number;
  hardDeadlineMonotonicMs?: number;
  renew: AdoptedSessionRenewalSupplier;
  continuity: boolean;
  release?: AdoptedSessionReleaseCallback | undefined;
  focusGraceDeadlineMs?: number | undefined;
  retryAtMs?: number | undefined;
  retryAttempt: number;
  lastContinuationAtMs?: number;
  /**
   * Consecutive malformed or non-advancing renewal responses (responses that
   * merely lost a race to a longer expiry excluded). Capped before the
   * adoption falls back to the ordinary cookie refresh.
   */
  stalledRenewals: number;
}

export interface AdoptedSessionBootContext {
  getOrdinarySessionSnapshot: (signal?: AbortSignal) => Promise<AuthenticatedSession>;
  snapshotOrdinarySession: (signal?: AbortSignal) => Promise<AuthenticatedSession>;
  adoptSession: (session: AuthenticatedSession, options: AdoptSessionOptions) => Promise<boolean>;
  releaseAdoptedSession: (reason?: AdoptedSessionReleaseReason) => Promise<void>;
}

/**
 * Optional boot hook. It may return a decision object, call `adoptSession`
 * itself, or return null/undefined to continue with the ordinary cookie
 * session. Retryable failures should be returned as `{type: 'recovery'}` so a
 * composing application can render its recovery surface. An adopted decision
 * from this hook is continuity-enabled by default and must include a valid
 * `hardDeadline`; direct `adoptSession` callers retain the legacy default
 * unless they explicitly set `continuity: true`.
 */
export type AdoptedSessionBootRestorer = (
  context: AdoptedSessionBootContext,
) => unknown | Promise<unknown>;

export interface AdoptedSessionBootRecoveryProps {
  error: unknown;
  retry: () => void;
}

/** Renders the composing application's recovery surface for boot failures. */
export type AdoptedSessionBootRecovery = (props: AdoptedSessionBootRecoveryProps) => ReactNode;

export type {AdoptedSessionReleaseReason};

type RenewalCandidate = {
  expiryMs: number;
  currentExpiryMs: number;
  valid: boolean;
  advancesWindow: boolean;
};

function renewalCandidate(
  result: AdoptedSessionRenewal,
  current: AdoptedSessionRuntimeState,
  reservedExpiryMs: number,
): RenewalCandidate {
  const expiryMs = Date.parse(result.expiresAt);
  const serverTimeMs = Date.parse(result.serverTime);
  const parsedCurrentExpiryMs = Date.parse(current.expiresAt);
  const currentExpiryMs = Number.isFinite(parsedCurrentExpiryMs) ? parsedCurrentExpiryMs : 0;
  const valid =
    Number.isFinite(expiryMs) && Number.isFinite(serverTimeMs) && expiryMs > serverTimeMs;
  return {
    expiryMs,
    currentExpiryMs,
    valid,
    advancesWindow: valid && expiryMs > Math.max(currentExpiryMs, reservedExpiryMs),
  };
}

async function requestAdoptedRenewal(
  adopted: AdoptedSessionRuntimeState,
): Promise<AdoptedSessionRenewal | null> {
  try {
    return await adopted.renew();
  } catch {
    return null;
  }
}

function renewalSupplier(options: AdoptSessionOptions): AdoptedSessionRenewalSupplier {
  return options.renew ?? (() => Promise.resolve(null));
}

function releaseCallback(options: AdoptSessionOptions): AdoptedSessionReleaseCallback | undefined {
  return options.onRelease;
}

function isContinuityOptions(options: AdoptSessionOptions): boolean {
  return options.continuity === true;
}

function observedLifetimeMs(expiresAt: string, serverTime: string): number {
  const lifetime = Date.parse(expiresAt) - Date.parse(serverTime);
  return Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 0;
}

/** Computes the bounded lead used by continuity-aware adoptions. */
export function getAdoptedSessionContinuityRenewLeadMs(lifetimeMs: number): number {
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) return 0;
  return Math.min(REFRESH_EARLY_MS, lifetimeMs / 3);
}

/** Computes a continuity renewal delay from issuer timestamps. */
export function getAdoptedSessionContinuityRenewDelayMs(
  expiresAt: string,
  serverTime: string,
): number {
  const lifetime = observedLifetimeMs(expiresAt, serverTime);
  return lifetime - getAdoptedSessionContinuityRenewLeadMs(lifetime);
}

function monotonicNow(): number {
  return performance.now();
}

function throwIfRequestAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Operation aborted');
}

async function waitForRequestSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  throwIfRequestAborted(signal);
  if (signal === undefined) return await promise;

  let onAbort: (() => void) | undefined;
  const abort = new Promise<never>((_, reject) => {
    const handleAbort = () => reject(signal.reason ?? new Error('Operation aborted'));
    onAbort = handleAbort;
    signal.addEventListener('abort', handleAbort, {once: true});
    if (signal.aborted) handleAbort();
  });
  try {
    return await Promise.race([promise, abort]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}

function hasVisibleFocusedDocument(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    (typeof document.hasFocus !== 'function' || document.hasFocus())
  );
}

const adoptedSessionAtom = atom<AdoptedSessionRuntimeState | null>(null);
const adoptionGenerationAtom = atom(0);
/**
 * Expiry reserved by a renewal whose adoption transition is still running.
 * Overlapping renewals compare against it so a shorter response cannot slip
 * past the later-`expires_at` check while the longer one is entering.
 *
 * It lives in its own atom instead of inside {@link adoptedSessionAtom} so a
 * reservation write does not re-run `AuthRuntime`'s renewal effect: an effect
 * re-run while the first transition is still pending would reset the
 * in-flight guard and schedule another renewal from the old expiry, letting
 * an already-due adoption invoke the supplier a second time.
 */
const adoptedRenewalReservationAtom = atom(0);

function invalidateRefresh(queryClient: QueryClient): void {
  refreshPromises.delete(queryClient);
}

async function refetchPausedActiveQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.refetchQueries({
    type: 'active',
    predicate: (query) => isAdoptedSessionPausedError(query.state.error),
  });
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
  /** Changes when the principal or workspace memberships can affect routing. */
  routeRevision?: string;
  isLoading: boolean;
  isAuthenticated: boolean;
  workspaces: Workspace[];
  hasWorkspace: boolean;
}

export const initialAuthState: AuthState = {status: 'loading'};
export const authStateAtom = atom<AuthState>(initialAuthState);
const authTransitionEpochAtom = atom(0);

/**
 * Identifies authentication changes that can affect route guards without
 * including the bearer token used for ordinary request renewal.
 */
export function getAuthRouteRevision(
  state: Pick<AuthState, 'status' | 'user' | 'workspaces'>,
): string {
  const workspaces = (state.workspaces ?? [])
    .map((workspace) => ({
      id: workspace.id,
      slug: workspace.slug,
      membershipId: workspace.membershipId,
      status: workspace.status,
    }))
    .sort(
      (left, right) =>
        left.id.localeCompare(right.id) || left.membershipId.localeCompare(right.membershipId),
    );

  return JSON.stringify({
    status: state.status,
    principalId: state.user?.id,
    principalRole: state.user?.adminRole,
    workspaces,
  });
}

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

function workspacesForHydrationFailure(
  previousState: AuthState,
  principalChanged: boolean,
): WorkspaceSummary[] {
  if (principalChanged || previousState.status !== 'authenticated') return [];
  return previousState.workspaces ?? [];
}

export function useAuthState(): AuthStateValue {
  const state = useAtomValue(authStateAtom);
  return useMemo(
    () => ({
      ...state,
      routeRevision: getAuthRouteRevision(state),
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

/**
 * Delay until the adopted session's renewal point, derived from the issuer
 * timestamps only. Both values come from the server, so a skewed browser
 * clock cannot shorten or lengthen the window. Negative when the renewal
 * point already passed; callers clamp.
 */
export function getAdoptedSessionRenewDelayMs(expiresAt: string, serverTime: string): number {
  const lifetime = Date.parse(expiresAt) - Date.parse(serverTime);
  return Number.isFinite(lifetime) ? lifetime - REFRESH_EARLY_MS : 0;
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

  const clearPrivateState = useCallback(
    async (epoch: number): Promise<boolean> => {
      await queryClient.cancelQueries();
      // A superseded transition must not clear the cache: the clear would
      // destroy an in-flight query owned by the transition that superseded it
      // (for example the cookie fallback started by a release during a mint).
      if (store.get(authTransitionEpochAtom) !== epoch) return false;
      queryClient.clear();
      return true;
    },
    [queryClient, store],
  );

  const enterGuest = useCallback(
    async (transitionEpoch?: number) => {
      const isExternalTransition = transitionEpoch === undefined;
      const epoch = transitionEpoch ?? beginAuthTransition();
      if (isExternalTransition) invalidateRefresh(queryClient);
      if (store.get(authTransitionEpochAtom) !== epoch) return false;

      if (!(await clearPrivateState(epoch))) return false;
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

      if (principalChanged) {
        if (!(await clearPrivateState(epoch))) return false;
        setLastWorkspaceId(undefined);
      }

      queryClient.setQueryData(authRefreshQueryKey, session);
      let workspaces = workspacesForHydrationFailure(previousState, principalChanged);
      try {
        const hydratedWorkspaces = await queryClient.fetchQuery(
          userWorkspacesQueryOptions(session.accessToken),
        );
        workspaces = hydratedWorkspaces.memberships;
      } catch {
        // A failed request does not prove that the same principal lost its memberships.
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
  const store = useStore();
  const {beginAuthTransition, enterAuthenticated, enterGuest} = useAuthTransition();

  return useCallback(() => {
    const existingRefresh = refreshPromises.get(queryClient);
    if (existingRefresh) return existingRefresh;

    if (store.get(adoptedSessionAtom) !== null) {
      // The ordinary refresh restores the cookie principal; running it while
      // an adoption is live would desync the adopted token from its metadata
      // and make product requests carry the administrator credential. ADR
      // 0014: the adopted bearer token is the only request credential.
      return Promise.reject(
        new ApiError({
          message: 'The adopted session must end before the ordinary cookie refresh.',
          code: 'unauthorized',
          status: 401,
        }),
      );
    }

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
  }, [beginAuthTransition, enterAuthenticated, enterGuest, queryClient, store]);
}

/**
 * The adopted-session runtime seam. An adopted session is an externally minted
 * access-token-only session entered through the ordinary authenticated path;
 * it suspends the cookie-based proactive refresh and runs until its issuer
 * expiry, then asks the renewal supplier or falls back to the cookie.
 *
 * Release is terminal for the tab: it increments an adoption generation before
 * ending the adoption, and a mint or renewal response is adopted only when its
 * generation still matches the current one. Tabs share no adopted token and no
 * release state.
 *
 * The renew timer asks the supplier near the issuer expiry without operator
 * action. ADR 0014 renewal is a deliberate administrator action, so callers
 * gate the supplier on the operator's Extend signal (returning `null`
 * otherwise) to keep every extension deliberate and audited.
 */
type ContinuationAttempt =
  | {kind: 'success'; renewal: AdoptedSessionRenewal}
  | {kind: 'retryable'; delayMs: number}
  | {kind: 'paused'}
  | {kind: 'terminal'; reason: AdoptedSessionReleaseReason}
  | {kind: 'stale'};

type RenewalAdoptionResult =
  | {kind: 'success'; renewal: AdoptedSessionRenewal}
  | {kind: 'terminal'; reason: AdoptedSessionReleaseReason}
  | {kind: 'stale'};

interface AdoptedSessionControl {
  continuation: {
    generation: number;
    promise: Promise<ContinuationAttempt>;
  } | null;
  terminal: {
    generation: number;
    promise: Promise<never>;
    reject: (error: Error) => void;
  } | null;
  pendingRelease: {
    generation: number;
    accessToken: string;
    tokenExpiresAtMs: number;
    release?: AdoptedSessionReleaseCallback | undefined;
  } | null;
  /**
   * A request can receive a 401 after its adopted session has ended, including
   * after another adoption has started. Keep those credentials as an
   * in-memory retry guard until their known token lifetime ends; they are
   * never persisted or logged.
   */
  releasedAdoptedTokens: Map<string, number>;
  releaseNotified: Set<number>;
  lastReleaseReason: AdoptedSessionReleaseReason;
  wakeWaiters: Set<() => void>;
  focusState: boolean | undefined;
}

const adoptedSessionControlAtom = atom<AdoptedSessionControl | null>(null);

function getAdoptedSessionControl(store: ReturnType<typeof useStore>): AdoptedSessionControl {
  const existing = store.get(adoptedSessionControlAtom);
  if (existing !== null) return existing;
  const control: AdoptedSessionControl = {
    continuation: null,
    terminal: null,
    pendingRelease: null,
    releasedAdoptedTokens: new Map(),
    releaseNotified: new Set(),
    lastReleaseReason: 'manual-stop',
    wakeWaiters: new Set(),
    focusState: undefined,
  };
  store.set(adoptedSessionControlAtom, control);
  return control;
}

function pruneReleasedAdoptedTokens(control: AdoptedSessionControl, now = monotonicNow()): void {
  for (const [accessToken, tokenExpiresAtMs] of control.releasedAdoptedTokens) {
    if (tokenExpiresAtMs <= now) control.releasedAdoptedTokens.delete(accessToken);
  }
}

function rememberReleasedAdoptedToken(
  control: AdoptedSessionControl,
  accessToken: string,
  tokenExpiresAtMs: number,
): void {
  const now = monotonicNow();
  pruneReleasedAdoptedTokens(control, now);
  if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= now) return;
  control.releasedAdoptedTokens.set(accessToken, tokenExpiresAtMs);
}

function rememberSupersededAdoptedToken(
  control: AdoptedSessionControl,
  current: AdoptedSessionRuntimeState,
  replacement: AuthenticatedSession,
): void {
  if (current.session.accessToken === replacement.accessToken) return;
  rememberReleasedAdoptedToken(control, current.session.accessToken, current.tokenExpiresAtMs);
}

function isStaleAdoptedRetry(
  accessToken: string | undefined,
  current: AdoptedSessionRuntimeState | null,
  control: AdoptedSessionControl,
): boolean {
  if (accessToken === undefined) return false;
  pruneReleasedAdoptedTokens(control);
  if (control.releasedAdoptedTokens.has(accessToken)) return true;
  return current !== null && current.session.accessToken !== accessToken;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function retryAfterSecondsMs(value: unknown): number | undefined {
  let seconds: number;
  if (typeof value === 'number') {
    seconds = value;
  } else if (typeof value === 'string' && RETRY_AFTER_SECONDS_RE.test(value)) {
    seconds = Number(value);
  } else {
    return undefined;
  }
  if (!isNonNegativeFiniteNumber(seconds)) return undefined;
  const delayMs = seconds * 1_000;
  return Number.isFinite(delayMs) ? delayMs : undefined;
}

function retryAfterMs(error: unknown): number | undefined {
  const candidate = error as {retryAfterMs?: unknown; retryAfter?: unknown};
  if (isNonNegativeFiniteNumber(candidate.retryAfterMs)) return candidate.retryAfterMs;
  if (isNonNegativeFiniteNumber(candidate.retryAfter)) return candidate.retryAfter;
  if (!(error instanceof ApiError) || typeof error.details !== 'object' || error.details === null) {
    return undefined;
  }
  const envelope = error.details as Record<string, unknown>;
  const details =
    typeof envelope.details === 'object' && envelope.details !== null
      ? (envelope.details as Record<string, unknown>)
      : envelope;
  const retryAfterSeconds = retryAfterSecondsMs(details.retry_after_seconds);
  if (retryAfterSeconds !== undefined) return retryAfterSeconds;
  const value = details.retry_after ?? details.retryAfter ?? details['retry-after'];
  if (isNonNegativeFiniteNumber(value)) return value;
  return retryAfterSecondsMs(value);
}

function continuationFailure(
  error: unknown,
): {kind: 'retryable'; delayMs: number} | {kind: 'terminal'; reason: AdoptedSessionReleaseReason} {
  if (error instanceof ApiError && (error.status === 401 || error.code === 'unauthorized')) {
    return {kind: 'terminal', reason: 'adopted-unauthorized'};
  }
  if (error instanceof ApiError && TERMINAL_CONTINUATION_CODES.has(error.code)) {
    return {kind: 'terminal', reason: 'continuation-terminal'};
  }
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 0 || status === 429 || status >= 500) {
    return {kind: 'retryable', delayMs: retryAfterMs(error) ?? 0};
  }
  if (!(error instanceof ApiError)) return {kind: 'retryable', delayMs: retryAfterMs(error) ?? 0};
  return {kind: 'terminal', reason: 'continuation-terminal'};
}

export function useAdoptedSession() {
  const store = useStore();
  const queryClient = useQueryClient();
  const {beginAuthTransition, enterAuthenticated, enterGuest} = useAuthTransition();
  const refreshAuth = useRefreshAuth();
  const adoptedSession = useAtomValue(adoptedSessionAtom);
  const control = getAdoptedSessionControl(store);

  const notifyRelease = useCallback(
    async (
      generation: number,
      release: AdoptedSessionReleaseCallback | undefined,
      reason: AdoptedSessionReleaseReason,
    ): Promise<void> => {
      if (!release || control.releaseNotified.has(generation)) return;
      control.releaseNotified.add(generation);
      try {
        await release(reason);
      } catch {
        // A composing release hook cannot keep the tab under an adopted bearer.
      }
    },
    [control],
  );

  const isAttended = useCallback(
    (current: AdoptedSessionRuntimeState, now = monotonicNow()) => {
      if (!current.continuity || typeof document === 'undefined') return true;
      if (document.visibilityState !== 'visible') return false;
      const focused = control.focusState ?? document.hasFocus();
      if (focused) return true;
      return current.focusGraceDeadlineMs !== undefined && now < current.focusGraceDeadlineMs;
    },
    [control],
  );

  const wakeContinuationWaiters = useCallback(() => {
    for (const wake of control.wakeWaiters) wake();
    control.wakeWaiters.clear();
  }, [control]);

  const createTerminalSignal = useCallback(
    (generation: number) => {
      let reject: (error: Error) => void = () => undefined;
      const promise = new Promise<never>((_, rejectPromise) => {
        reject = rejectPromise;
      });
      // A terminal signal may be created before a request starts waiting on it.
      // Attach a sink so local release cannot surface an unhandled rejection.
      void promise.catch(() => undefined);
      control.terminal = {generation, promise, reject};
    },
    [control],
  );

  // The release path intentionally owns local invalidation, callback delivery, and cookie fallback.
  const endAdoption = useCallback(
    async (
      reason: AdoptedSessionReleaseReason = 'manual-stop',
      restoreCookie = reason !== 'logout' && reason !== 'replaced',
    ): // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: these authority-reducing branches must stay ordered.
    Promise<void> => {
      const current = store.get(adoptedSessionAtom);
      const pending = control.pendingRelease;
      if (current === null && pending === null) return;

      const previousGeneration = store.get(adoptionGenerationAtom);
      const nextGeneration = previousGeneration + 1;
      const releaseGeneration = current?.generation ?? pending?.generation ?? previousGeneration;
      const release = current?.release ?? pending?.release;
      if (current !== null) {
        rememberReleasedAdoptedToken(
          control,
          current.session.accessToken,
          current.tokenExpiresAtMs,
        );
      } else if (pending !== null) {
        rememberReleasedAdoptedToken(control, pending.accessToken, pending.tokenExpiresAtMs);
      }
      const endedError = createAdoptedSessionEndedError(reason);
      control.lastReleaseReason = reason;
      store.set(adoptionGenerationAtom, nextGeneration);
      store.set(adoptedRenewalReservationAtom, 0);
      store.set(adoptedSessionAtom, null);
      control.pendingRelease = null;
      control.continuation = null;
      wakeContinuationWaiters();
      if (control.terminal?.generation === releaseGeneration) {
        control.terminal.reject(endedError);
        control.terminal = null;
      }
      if (release !== undefined) await notifyRelease(releaseGeneration, release, reason);
      if (!restoreCookie) return;
      if (store.get(adoptionGenerationAtom) !== nextGeneration) return;

      try {
        await refreshAuth();
      } catch (error) {
        // A superseded restore is not a failure: a newer transition (for
        // example a fresh adoption) already owns the session.
        if (
          error instanceof ApiError &&
          error.message === 'Authentication refresh was superseded.'
        ) {
          return;
        }
        if (store.get(adoptionGenerationAtom) !== nextGeneration) return;
        // The adopted token must never remain ambient after release, even if
        // the ordinary cookie has expired or the network is unavailable.
        if (store.get(authStateAtom).status !== 'guest') await enterGuest();
      }
    },
    [control, enterGuest, notifyRelease, refreshAuth, store, wakeContinuationWaiters],
  );

  // Bootstrap and ordinary adoption share one generation-safe transition.
  const adoptSession = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the transition boundary must validate every state before publishing it.
    async (session: AuthenticatedSession, options: AdoptSessionOptions): Promise<boolean> => {
      const continuity = isContinuityOptions(options);
      const deadlineText = continuity ? options.hardDeadline : undefined;
      const deadlineMs = deadlineText ? Date.parse(deadlineText) : Number.NaN;
      const serverTimeMs = Date.parse(options.serverTime);
      if (
        continuity &&
        (deadlineText === undefined ||
          !Number.isFinite(deadlineMs) ||
          !Number.isFinite(serverTimeMs))
      ) {
        throw new Error('Continuity adoptions require valid hardDeadline and serverTime.');
      }
      const previous = store.get(adoptedSessionAtom);
      const pending = control.pendingRelease;
      if (previous !== null || pending !== null) {
        control.lastReleaseReason = 'replaced';
        control.continuation = null;
        wakeContinuationWaiters();
      }
      if (previous !== null) {
        rememberReleasedAdoptedToken(
          control,
          previous.session.accessToken,
          previous.tokenExpiresAtMs,
        );
        void notifyRelease(previous.generation, previous.release, 'replaced');
      }
      if (pending !== null) {
        rememberReleasedAdoptedToken(control, pending.accessToken, pending.tokenExpiresAtMs);
        void notifyRelease(pending.generation, pending.release, 'replaced');
      }
      if (control.terminal) {
        control.terminal.reject(createAdoptedSessionEndedError('replaced'));
        control.terminal = null;
      }

      // Every adoption gets a fresh generation. A late mint or continuation
      // from an earlier generation can therefore never enter ambient auth.
      const generation = store.get(adoptionGenerationAtom) + 1;
      store.set(adoptionGenerationAtom, generation);
      store.set(adoptedRenewalReservationAtom, 0);
      const release = releaseCallback(options);
      const receivedAtMs = monotonicNow();
      const lifetimeMs = observedLifetimeMs(options.expiresAt, options.serverTime);
      control.pendingRelease = {
        generation,
        accessToken: session.accessToken,
        tokenExpiresAtMs: receivedAtMs + lifetimeMs,
        ...(release === undefined ? {} : {release}),
      };
      const transitionEpoch = beginAuthTransition();
      invalidateRefresh(queryClient);
      control.focusState =
        typeof document === 'undefined'
          ? true
          : document.visibilityState === 'visible' && document.hasFocus();
      const hardDeadlineMonotonicMs =
        Number.isFinite(deadlineMs) && Number.isFinite(serverTimeMs)
          ? receivedAtMs + Math.max(0, deadlineMs - serverTimeMs)
          : undefined;
      const initialState: AdoptedSessionRuntimeState = {
        generation,
        receivedAtMs,
        observedLifetimeMs: lifetimeMs,
        tokenExpiresAtMs: receivedAtMs + lifetimeMs,
        ...(Number.isFinite(deadlineMs) ? {hardDeadlineMs: deadlineMs} : {}),
        ...(hardDeadlineMonotonicMs !== undefined ? {hardDeadlineMonotonicMs} : {}),
        session,
        expiresAt: options.expiresAt,
        serverTime: options.serverTime,
        ...(deadlineText ? {hardDeadline: deadlineText} : {}),
        renewalState: continuity && !hasVisibleFocusedDocument() ? 'paused' : 'active',
        isRenewalPaused: continuity && !hasVisibleFocusedDocument(),
        renew: renewalSupplier(options),
        continuity,
        ...(release === undefined ? {} : {release}),
        retryAttempt: 0,
        stalledRenewals: 0,
      };

      const accepted = await enterAuthenticated(session, transitionEpoch);
      if (!accepted || store.get(adoptionGenerationAtom) !== generation) {
        if (control.pendingRelease?.generation === generation) control.pendingRelease = null;
        const terminal = control.terminal as {
          generation: number;
          promise: Promise<never>;
          reject: (error: Error) => void;
        } | null;
        if (terminal && terminal.generation === generation) control.terminal = null;
        return false;
      }
      store.set(adoptedSessionAtom, initialState);
      control.pendingRelease = null;
      createTerminalSignal(generation);
      return true;
    },
    [
      beginAuthTransition,
      createTerminalSignal,
      enterAuthenticated,
      notifyRelease,
      queryClient,
      store,
      control,
      wakeContinuationWaiters,
    ],
  );

  // Focus and visibility are one attendance state machine at this boundary.
  const updateAdoptedAttendance = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: browser event precedence is intentionally centralized.
    (event: 'focus' | 'blur' | 'visibility' | 'online') => {
      const current = store.get(adoptedSessionAtom);
      if (current === null || !current.continuity) {
        wakeContinuationWaiters();
        return;
      }
      const now = monotonicNow();
      const isVisible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (event === 'focus') control.focusState = true;
      if (event === 'blur') control.focusState = false;
      if (event === 'visibility' && !isVisible) control.focusState = false;
      if (event === 'visibility' && isVisible && control.focusState === undefined) {
        control.focusState = document.hasFocus();
      }

      let focusGraceDeadlineMs = current.focusGraceDeadlineMs;
      if (!isVisible) {
        focusGraceDeadlineMs = undefined;
      } else if (event === 'blur' && focusGraceDeadlineMs === undefined) {
        const proposed = now + current.observedLifetimeMs;
        focusGraceDeadlineMs =
          current.hardDeadlineMonotonicMs === undefined
            ? proposed
            : Math.min(proposed, current.hardDeadlineMonotonicMs);
      } else if (event === 'focus') {
        focusGraceDeadlineMs = undefined;
      }

      const attended = isAttended({...current, focusGraceDeadlineMs}, now);
      const renewalState = attended ? 'active' : 'paused';
      if (
        focusGraceDeadlineMs !== current.focusGraceDeadlineMs ||
        renewalState !== current.renewalState
      ) {
        store.set(adoptedSessionAtom, {
          ...current,
          ...(focusGraceDeadlineMs === undefined ? {} : {focusGraceDeadlineMs}),
          ...(focusGraceDeadlineMs === undefined ? {focusGraceDeadlineMs: undefined} : {}),
          renewalState,
          isRenewalPaused: !attended,
        });
      }
      wakeContinuationWaiters();
    },
    [control, isAttended, store, wakeContinuationWaiters],
  );

  const waitForRelease = useCallback(
    async <T,>(promise: Promise<T>, generation: number): Promise<T> => {
      const terminal = control.terminal;
      if (!terminal || terminal.generation !== generation) return promise;
      return await Promise.race([promise, terminal.promise]);
    },
    [control],
  );

  const waitForDelay = useCallback(
    async (
      delayMs: number,
      generation: number,
      wakeable = false,
      signal?: AbortSignal,
    ): Promise<void> => {
      throwIfRequestAborted(signal);
      if (delayMs <= 0) return;
      const timer = new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      let wakeResolver: (() => void) | undefined;
      const wake = wakeable
        ? new Promise<void>((resolve) => {
            wakeResolver = () => resolve();
            control.wakeWaiters.add(wakeResolver);
          })
        : undefined;
      try {
        await waitForRequestSignal(
          waitForRelease(wake ? Promise.race([timer, wake]) : timer, generation),
          signal,
        );
      } finally {
        if (wakeResolver !== undefined) control.wakeWaiters.delete(wakeResolver);
      }
    },
    [control, waitForRelease],
  );

  const setRetryableState = useCallback(
    (current: AdoptedSessionRuntimeState, requestedDelayMs: number): number => {
      const backoff = Math.min(
        CONTINUATION_RETRY_MAX_MS,
        CONTINUATION_RETRY_BASE_MS * 2 ** current.retryAttempt,
      );
      const delayMs = Math.max(requestedDelayMs, backoff);
      const retryAtMs = monotonicNow() + delayMs;
      store.set(adoptedSessionAtom, {
        ...current,
        retryAtMs,
        retryAttempt: current.retryAttempt + 1,
        renewalState: isAttended(current) ? 'recovering' : 'paused',
        isRenewalPaused: !isAttended(current),
      });
      return delayMs;
    },
    [isAttended, store],
  );

  const adoptRenewalResult = useCallback(
    async ({
      result,
      candidateExpiryMs,
      generation,
      adopted,
    }: {
      result: AdoptedSessionRenewal;
      candidateExpiryMs: number;
      generation: number;
      adopted: AdoptedSessionRuntimeState;
    }): Promise<RenewalAdoptionResult> => {
      if (store.get(adoptionGenerationAtom) !== generation) return {kind: 'stale'};
      if (result.session.user.id !== adopted.session.user.id) {
        store.set(adoptedRenewalReservationAtom, 0);
        return {kind: 'terminal', reason: 'continuation-terminal'};
      }
      const receivedAtMs = monotonicNow();
      const transitionEpoch = beginAuthTransition();
      invalidateRefresh(queryClient);
      const accepted = await enterAuthenticated(result.session, transitionEpoch);
      if (!accepted || store.get(adoptionGenerationAtom) !== generation) {
        if (store.get(adoptedRenewalReservationAtom) === candidateExpiryMs) {
          store.set(adoptedRenewalReservationAtom, 0);
        }
        return {kind: 'stale'};
      }
      const latest = store.get(adoptedSessionAtom) ?? adopted;
      const lifetimeMs = observedLifetimeMs(result.expiresAt, result.serverTime);
      const attended = isAttended(latest, receivedAtMs);
      rememberSupersededAdoptedToken(control, latest, result.session);
      store.set(adoptedRenewalReservationAtom, 0);
      store.set(adoptedSessionAtom, {
        ...latest,
        generation,
        receivedAtMs,
        observedLifetimeMs: lifetimeMs,
        tokenExpiresAtMs: receivedAtMs + lifetimeMs,
        session: result.session,
        expiresAt: result.expiresAt,
        serverTime: result.serverTime,
        renewalState: latest.continuity && !attended ? 'paused' : 'active',
        isRenewalPaused: latest.continuity && !attended,
        retryAtMs: undefined,
        retryAttempt: 0,
        stalledRenewals: 0,
      });
      return {kind: 'success', renewal: result};
    },
    [beginAuthTransition, control, enterAuthenticated, isAttended, queryClient, store],
  );

  const handleNonAdvancingRenewal = useCallback(
    async (
      candidate: RenewalCandidate,
      current: AdoptedSessionRuntimeState,
      adopted: AdoptedSessionRuntimeState,
    ): Promise<void> => {
      const lostRace =
        candidate.valid &&
        (candidate.expiryMs > candidate.currentExpiryMs ||
          candidate.currentExpiryMs > Date.parse(adopted.expiresAt));
      if (candidate.valid && lostRace) return;

      const stalled = {...current, stalledRenewals: current.stalledRenewals + 1};
      store.set(adoptedSessionAtom, stalled);
      if (stalled.stalledRenewals >= ADOPTED_RENEWAL_STALL_LIMIT) {
        await endAdoption('continuation-terminal');
      }
    },
    [endAdoption, store],
  );

  // This is the only path that can turn a continuation response into a token swap.
  const performContinuityRenewal = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: protocol validation and stale-response checks are inseparable here.
    async (input: AdoptedSessionContinuationInput): Promise<ContinuationAttempt> => {
      const adopted = store.get(adoptedSessionAtom);
      if (adopted === null) return {kind: 'stale'};
      const generation = adopted.generation;
      const now = monotonicNow();
      if (!isAttended(adopted, now)) {
        store.set(adoptedSessionAtom, {
          ...adopted,
          renewalState: 'paused',
          isRenewalPaused: true,
        });
        return {kind: 'paused'};
      }
      if (adopted.hardDeadlineMonotonicMs !== undefined && now >= adopted.hardDeadlineMonotonicMs) {
        return {kind: 'terminal', reason: 'hard-deadline'};
      }
      if (
        input.source === 'unauthorized' &&
        adopted.hardDeadlineMonotonicMs !== undefined &&
        adopted.tokenExpiresAtMs >= adopted.hardDeadlineMonotonicMs &&
        now < adopted.hardDeadlineMonotonicMs
      ) {
        return {kind: 'terminal', reason: 'adopted-unauthorized'};
      }

      let result: AdoptedSessionRenewal | null;
      try {
        result = await waitForRelease(adopted.renew(input), generation);
      } catch (error) {
        if (store.get(adoptionGenerationAtom) !== generation) return {kind: 'stale'};
        const failure = continuationFailure(error);
        if (failure.kind === 'terminal') return failure;
        const delayMs = setRetryableState(adopted, failure.delayMs);
        return {kind: 'retryable', delayMs};
      }
      if (store.get(adoptionGenerationAtom) !== generation) return {kind: 'stale'};
      if (result === null) return {kind: 'terminal', reason: 'continuation-terminal'};

      const current = store.get(adoptedSessionAtom);
      if (current === null || current.generation !== generation) return {kind: 'stale'};
      if (result.session.user.id !== current.session.user.id) {
        if (store.get(adoptionGenerationAtom) !== generation) return {kind: 'stale'};
        store.set(adoptedRenewalReservationAtom, 0);
        return {kind: 'terminal', reason: 'continuation-terminal'};
      }
      if (
        current.hardDeadlineMs !== undefined &&
        Date.parse(result.serverTime) >= current.hardDeadlineMs
      ) {
        return {kind: 'terminal', reason: 'hard-deadline'};
      }
      const candidate = renewalCandidate(result, current, store.get(adoptedRenewalReservationAtom));
      if (!candidate.valid || !candidate.advancesWindow) {
        const lostRace =
          candidate.valid &&
          (candidate.expiryMs > candidate.currentExpiryMs ||
            candidate.currentExpiryMs > Date.parse(adopted.expiresAt));
        if (lostRace) return {kind: 'stale'};
        const stalled = {...current, stalledRenewals: current.stalledRenewals + 1};
        store.set(adoptedSessionAtom, stalled);
        if (stalled.stalledRenewals >= CONTINUATION_STALL_LIMIT) {
          return {kind: 'terminal', reason: 'continuation-terminal'};
        }
        const delayMs = setRetryableState(stalled, 0);
        return {kind: 'retryable', delayMs};
      }
      if (current.hardDeadlineMs !== undefined && candidate.expiryMs > current.hardDeadlineMs) {
        return {kind: 'terminal', reason: 'continuation-terminal'};
      }
      if (candidate.expiryMs > store.get(adoptedRenewalReservationAtom)) {
        store.set(adoptedRenewalReservationAtom, candidate.expiryMs);
      }
      const adoption = await adoptRenewalResult({
        result,
        candidateExpiryMs: candidate.expiryMs,
        generation,
        adopted: current,
      });
      if (adoption.kind === 'terminal') return adoption;
      if (adoption.kind === 'stale') return {kind: 'stale'};
      await refetchPausedActiveQueries(queryClient);
      return {kind: 'success', renewal: adoption.renewal};
    },
    [adoptRenewalResult, isAttended, queryClient, setRetryableState, store, waitForRelease],
  );

  const runContinuityRenewal = useCallback(
    (input: AdoptedSessionContinuationInput): Promise<ContinuationAttempt> => {
      const current = store.get(adoptedSessionAtom);
      if (current === null) return Promise.resolve({kind: 'stale'});
      const existing = control.continuation;
      if (existing?.generation === current.generation) return existing.promise;

      const promise = (async (): Promise<ContinuationAttempt> => {
        const now = monotonicNow();
        const lastAttempt = current.lastContinuationAtMs;
        const minimumDelay =
          lastAttempt === undefined ? 0 : lastAttempt + CONTINUATION_MIN_INTERVAL_MS - now;
        const retryDelay = (current.retryAtMs ?? now) - now;
        const waitDelay = Math.max(minimumDelay, retryDelay);
        if (waitDelay > 0) {
          await waitForDelay(waitDelay, current.generation, input.source === 'request');
        }
        const latest = store.get(adoptedSessionAtom);
        if (latest === null || latest.generation !== current.generation) return {kind: 'stale'};
        store.set(adoptedSessionAtom, {
          ...latest,
          lastContinuationAtMs: monotonicNow(),
        });
        return await performContinuityRenewal(input);
      })();
      control.continuation = {generation: current.generation, promise};
      void promise.then(
        () => {
          if (control.continuation?.promise === promise) control.continuation = null;
        },
        () => {
          if (control.continuation?.promise === promise) control.continuation = null;
        },
      );
      return promise;
    },
    [control, performContinuityRenewal, store, waitForDelay],
  );

  // Legacy adoptions retain their original supplier semantics beside continuity mode.
  const renewAdoptedSession = useCallback(
    async (
      input: AdoptedSessionContinuationInput = {source: 'manual'},
    ): // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compatibility requires both renewal protocols at this seam.
    Promise<AdoptedSessionRenewal | null> => {
      const adopted = store.get(adoptedSessionAtom);
      if (adopted === null) return null;
      if (adopted.continuity) {
        throwIfRequestAborted(input.signal);
        const attempt = await waitForRequestSignal(
          runContinuityRenewal({...input, signal: undefined}),
          input.signal,
        );
        if (attempt.kind === 'success') return attempt.renewal;
        if (attempt.kind === 'terminal') await endAdoption(attempt.reason);
        return null;
      }

      const generation = store.get(adoptionGenerationAtom);
      const result = await requestAdoptedRenewal(adopted);
      if (store.get(adoptionGenerationAtom) !== generation) return null;
      if (result === null) {
        await endAdoption('continuation-terminal');
        return null;
      }
      const current = store.get(adoptedSessionAtom);
      if (current === null) return null;
      if (result.session.user.id !== current.session.user.id) {
        if (store.get(adoptionGenerationAtom) !== generation) return null;
        store.set(adoptedRenewalReservationAtom, 0);
        await endAdoption('continuation-terminal');
        return null;
      }
      const candidate = renewalCandidate(result, current, store.get(adoptedRenewalReservationAtom));
      if (!candidate.advancesWindow) {
        await handleNonAdvancingRenewal(candidate, current, adopted);
        return null;
      }
      if (candidate.expiryMs > store.get(adoptedRenewalReservationAtom)) {
        store.set(adoptedRenewalReservationAtom, candidate.expiryMs);
      }
      const adoption = await adoptRenewalResult({
        result,
        candidateExpiryMs: candidate.expiryMs,
        generation,
        adopted,
      });
      if (adoption.kind === 'terminal') {
        await endAdoption(adoption.reason);
        return null;
      }
      if (adoption.kind === 'stale') return null;
      await refetchPausedActiveQueries(queryClient);
      return adoption.renewal;
    },
    [
      adoptRenewalResult,
      endAdoption,
      handleNonAdvancingRenewal,
      queryClient,
      runContinuityRenewal,
      store,
    ],
  );

  // Requests remain behind one bounded continuation loop until success or release.
  const continueForRequest = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: every terminal and retryable gate outcome is handled at the request boundary.
    async (input: AdoptedSessionContinuationInput, force: boolean): Promise<string> => {
      const signal = input.signal;
      throwIfRequestAborted(signal);
      const requestGeneration = store.get(adoptedSessionAtom)?.generation;
      if (requestGeneration === undefined) {
        throw createAdoptedSessionEndedError(control.lastReleaseReason);
      }
      while (true) {
        throwIfRequestAborted(signal);
        const current = store.get(adoptedSessionAtom);
        if (current === null || current.generation !== requestGeneration) {
          throw createAdoptedSessionEndedError(control.lastReleaseReason);
        }
        const now = monotonicNow();
        const tokenExpired = now >= current.tokenExpiresAtMs;

        if (!force && !tokenExpired) {
          throwIfRequestAborted(signal);
          return current.session.accessToken;
        }
        if (!isAttended(current, now)) {
          store.set(adoptedSessionAtom, {
            ...current,
            renewalState: 'paused',
            isRenewalPaused: true,
          });
          throw createAdoptedSessionPausedError();
        }
        if (
          current.hardDeadlineMonotonicMs !== undefined &&
          now >= current.hardDeadlineMonotonicMs
        ) {
          await waitForRequestSignal(endAdoption('hard-deadline'), signal);
          throwIfRequestAborted(signal);
          throw createAdoptedSessionEndedError('hard-deadline');
        }
        const attempt = await waitForRequestSignal(
          runContinuityRenewal({...input, signal: undefined}),
          signal,
        );
        throwIfRequestAborted(signal);
        if (attempt.kind === 'success') {
          throwIfRequestAborted(signal);
          return attempt.renewal.session.accessToken;
        }
        if (attempt.kind === 'paused') throw createAdoptedSessionPausedError();
        if (attempt.kind === 'terminal') {
          await waitForRequestSignal(endAdoption(attempt.reason), signal);
          throwIfRequestAborted(signal);
          throw createAdoptedSessionEndedError(attempt.reason);
        }
        if (attempt.kind === 'stale') continue;

        const latest = store.get(adoptedSessionAtom);
        if (latest === null) throw createAdoptedSessionEndedError(control.lastReleaseReason);
        throwIfRequestAborted(signal);
        if (!isAttended(latest)) throw createAdoptedSessionPausedError();
        const retryAt = latest.retryAtMs ?? monotonicNow();
        await waitForDelay(Math.max(0, retryAt - monotonicNow()), latest.generation, true, signal);
        force = true;
      }
    },
    [control, endAdoption, isAttended, runContinuityRenewal, store, waitForDelay],
  );

  const getOrdinarySessionSnapshot = useCallback(
    (signal?: AbortSignal) => snapshotAuthenticatedSession(signal),
    [],
  );

  const releaseAdoptedSession = useCallback(
    async (reason: AdoptedSessionReleaseReason = 'manual-stop'): Promise<void> => {
      await endAdoption(reason);
    },
    [endAdoption],
  );

  return {
    adoptSession,
    continueForRequest,
    getOrdinarySessionSnapshot,
    getCookieSessionSnapshot: getOrdinarySessionSnapshot,
    snapshotOrdinarySession: getOrdinarySessionSnapshot,
    renewAdoptedSession,
    continueAdoptedSession: renewAdoptedSession,
    releaseAdoptedSession,
    updateAdoptedAttendance,
    isAdoptedSessionAttended: isAttended,
    adoptedSession,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// Boot decisions accept the small set of result shapes used by composing applications.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: compatibility result normalization is deliberately exhaustive.
function bootAdoptionDecision(
  value: unknown,
):
  | {kind: 'adopt'; session: AuthenticatedSession; options: AdoptSessionOptions}
  | {kind: 'ordinary'}
  | {kind: 'guest'}
  | {kind: 'recovery'; error: unknown}
  | {kind: 'pending'} {
  if (value === null || value === undefined || value === false) return {kind: 'ordinary'};
  if (value === true) return {kind: 'pending'};
  if (value === 'guest') return {kind: 'guest'};
  if (value === 'ordinary' || value === 'administrator' || value === 'continue-as-administrator') {
    return {kind: 'ordinary'};
  }
  if (!isRecord(value)) return {kind: 'ordinary'};
  const type = value.type ?? value.status ?? value.decision;
  if (type === 'guest') return {kind: 'guest'};
  if (type === 'recovery' || type === 'retryable') {
    return {
      kind: 'recovery',
      error: value.error ?? new Error('Adopted-session boot restoration requires recovery.'),
    };
  }
  if (type === 'pending') {
    return {kind: 'pending'};
  }
  if (type === 'ordinary' || type === 'administrator' || type === 'continue-as-administrator') {
    return {kind: 'ordinary'};
  }

  const sessionValue =
    value.session ?? (isRecord(value.adoptedSession) ? value.adoptedSession.session : undefined);
  const optionValue =
    value.options ?? (isRecord(value.adoptedSession) ? value.adoptedSession.options : value);
  if (!isRecord(sessionValue) || !isRecord(optionValue)) return {kind: 'ordinary'};
  if (
    typeof sessionValue.accessToken !== 'string' ||
    !isRecord(sessionValue.user) ||
    typeof sessionValue.user.id !== 'string' ||
    typeof sessionValue.user.email !== 'string' ||
    typeof optionValue.expiresAt !== 'string' ||
    typeof optionValue.serverTime !== 'string'
  ) {
    return {kind: 'ordinary'};
  }
  return {
    kind: 'adopt',
    session: sessionValue as unknown as AuthenticatedSession,
    options: optionValue as unknown as AdoptSessionOptions,
  };
}

export interface AuthRuntimeProps extends PropsWithChildren {
  effects?: boolean;
  /**
   * Restores a composing application's adopted session during boot. When a
   * restorer is supplied, the composing application must also supply
   * `bootRecovery` for non-authentication failures; the shell intentionally
   * does not invent product-specific recovery UI.
   */
  bootRestorer?: AdoptedSessionBootRestorer;
  /** Renders the composing application's recovery surface for boot failures. */
  bootRecovery?: AdoptedSessionBootRecovery;
}

export function AuthRuntime({
  children,
  effects = true,
  bootRestorer,
  bootRecovery,
}: AuthRuntimeProps) {
  const store = useStore();
  const adoptedControl = getAdoptedSessionControl(store);
  const authState = useAtomValue(authStateAtom);
  const refreshAuth = useRefreshAuth();
  const {enterGuest} = useAuthTransition();
  const {
    adoptedSession,
    adoptSession,
    continueForRequest,
    getOrdinarySessionSnapshot,
    renewAdoptedSession,
    releaseAdoptedSession,
    updateAdoptedAttendance,
    isAdoptedSessionAttended,
  } = useAdoptedSession();
  const lastBootAttemptRef = useRef<number | undefined>(undefined);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootError, setBootError] = useState<unknown>();
  const previousAuthStatusRef = useRef(authState.status);
  const retryBoot = useCallback(() => setBootAttempt((attempt) => attempt + 1), []);
  const restorer = bootRestorer;

  useEffect(() => {
    if (!effects) return;
    configureApiClient({
      getAccessToken: () => store.get(authStateAtom).token,
      prepareAccessToken: async ({accessToken, signal}) => {
        const current = store.get(adoptedSessionAtom);
        if (current === null || !current.continuity) return accessToken;
        return await continueForRequest({signal, source: 'request'}, false);
      },
      retryAccessToken: async ({accessToken, signal}) => {
        const current = store.get(adoptedSessionAtom);
        if (isStaleAdoptedRetry(accessToken, current, adoptedControl)) return undefined;
        if (current?.continuity) {
          return await continueForRequest({signal, source: 'unauthorized'}, true);
        }
        if (current !== null) {
          await releaseAdoptedSession('adopted-unauthorized');
          return undefined;
        }
        return (await refreshAuth()).accessToken;
      },
      refreshAccessToken: async (input) => {
        const current = store.get(adoptedSessionAtom);
        if (isStaleAdoptedRetry(input?.accessToken, current, adoptedControl)) return undefined;
        if (current !== null) {
          if (current.continuity) {
            return await continueForRequest({source: 'unauthorized'}, true);
          }
          await releaseAdoptedSession('adopted-unauthorized');
          return undefined;
        }
        return (await refreshAuth()).accessToken;
      },
    });
  }, [adoptedControl, continueForRequest, effects, refreshAuth, releaseAdoptedSession, store]);

  useEffect(() => {
    if (!effects || lastBootAttemptRef.current === bootAttempt) return;
    lastBootAttemptRef.current = bootAttempt;
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: boot must not enter the ordinary principal before the restorer decides.
    const runBoot = async () => {
      setBootError(undefined);
      if (!restorer) {
        await refreshAuth().catch(() => undefined);
        return;
      }
      try {
        const result = await restorer({
          getOrdinarySessionSnapshot,
          snapshotOrdinarySession: getOrdinarySessionSnapshot,
          adoptSession,
          releaseAdoptedSession,
        });
        const decision = bootAdoptionDecision(result);
        if (decision.kind === 'adopt') {
          const accepted = await adoptSession(decision.session, {
            ...decision.options,
            ...(decision.options.continuity === undefined ? {continuity: true} : {}),
          });
          if (!accepted && store.get(authStateAtom).status === 'loading') {
            await refreshAuth().catch(() => undefined);
          }
          return;
        }
        if (decision.kind === 'guest') {
          await enterGuest();
          return;
        }
        if (decision.kind === 'recovery') {
          setBootError(decision.error);
          return;
        }
        if (decision.kind === 'pending') return;
        await refreshAuth().catch(() => undefined);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          await enterGuest();
          return;
        }
        setBootError(error);
      }
    };
    void runBoot();
  }, [
    adoptSession,
    effects,
    enterGuest,
    getOrdinarySessionSnapshot,
    refreshAuth,
    releaseAdoptedSession,
    restorer,
    store,
    bootAttempt,
  ]);

  useEffect(() => {
    const previousStatus = previousAuthStatusRef.current;
    previousAuthStatusRef.current = authState.status;
    if (
      effects &&
      previousStatus === 'authenticated' &&
      authState.status === 'guest' &&
      store.get(adoptedSessionAtom) !== null
    ) {
      void releaseAdoptedSession('logout');
    }
  }, [authState.status, effects, releaseAdoptedSession, store]);

  useEffect(() => {
    if (
      !effects ||
      authState.status !== 'authenticated' ||
      !authState.token ||
      adoptedSession !== null
    ) {
      return;
    }

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
      if (store.get(adoptedSessionAtom) !== null) return;
      const delay = getAuthRefreshDelayMs(current.token);
      if (delay !== undefined && delay <= 0) scheduleRefresh(REFRESH_RETRY_DELAY_MS);
    };
    function runRefresh() {
      if (disposed || refreshing || store.get(adoptedSessionAtom) !== null) return;
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
      if (store.get(adoptedSessionAtom) !== null) return;
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
  }, [adoptedSession, authState.status, authState.token, effects, refreshAuth, store]);

  useEffect(() => {
    if (!effects || adoptedSession === null) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let renewing = false;
    let nextFireAtMs = 0;
    const clearRenewTimer = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
    };
    const clearDeadlineTimer = () => {
      if (deadlineTimeout !== undefined) clearTimeout(deadlineTimeout);
      deadlineTimeout = undefined;
    };
    const runHardDeadline = () => {
      if (disposed) return;
      const current = store.get(adoptedSessionAtom);
      const hardDeadline = current?.hardDeadlineMonotonicMs;
      if (current === null || hardDeadline === undefined) return;
      const remaining = hardDeadline - monotonicNow();
      if (remaining > 0) {
        deadlineTimeout = setTimeout(runHardDeadline, remaining);
        return;
      }
      void releaseAdoptedSession('hard-deadline');
    };
    const scheduleHardDeadline = () => {
      clearDeadlineTimer();
      const current = store.get(adoptedSessionAtom);
      const hardDeadline = current?.hardDeadlineMonotonicMs;
      if (hardDeadline === undefined) return;
      deadlineTimeout = setTimeout(runHardDeadline, Math.max(0, hardDeadline - monotonicNow()));
    };
    const scheduleRenew = () => {
      clearRenewTimer();
      const current = store.get(adoptedSessionAtom);
      if (current === null) return;
      const now = monotonicNow();
      const hardDeadline = current.hardDeadlineMonotonicMs;
      const tokenExpiry = current.tokenExpiresAtMs;
      const renewalAt = current.continuity
        ? current.receivedAtMs +
          getAdoptedSessionContinuityRenewDelayMs(current.expiresAt, current.serverTime)
        : current.receivedAtMs +
          getAdoptedSessionRenewDelayMs(current.expiresAt, current.serverTime);
      const shouldStopAtDeadline =
        hardDeadline !== undefined && (tokenExpiry >= hardDeadline || renewalAt >= hardDeadline);
      const nextRetry = current.retryAtMs ?? Number.POSITIVE_INFINITY;
      const focusGraceDeadline = current.focusGraceDeadlineMs ?? Number.POSITIVE_INFINITY;
      nextFireAtMs = Math.max(
        now,
        Math.min(
          shouldStopAtDeadline && hardDeadline !== undefined ? hardDeadline : renewalAt,
          nextRetry,
          tokenExpiry,
          hardDeadline ?? Number.POSITIVE_INFINITY,
          focusGraceDeadline,
        ),
      );
      timeout = setTimeout(runRenew, Math.max(0, nextFireAtMs - monotonicNow()));
    };
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: timer, attendance, deadline, and retry precedence is one scheduler.
    const runRenew = () => {
      if (disposed || renewing) return;
      const current = store.get(adoptedSessionAtom);
      if (current === null) return;
      const now = monotonicNow();
      if (current.hardDeadlineMonotonicMs !== undefined && now >= current.hardDeadlineMonotonicMs) {
        void releaseAdoptedSession('hard-deadline');
        return;
      }
      if (!current.continuity) {
        renewing = true;
        clearRenewTimer();
        renewAdoptedSession({source: 'timer'})
          .catch(() => undefined)
          .finally(() => {
            renewing = false;
            if (!disposed) scheduleRenew();
          });
        return;
      }
      const renewalAt =
        current.receivedAtMs +
        getAdoptedSessionContinuityRenewDelayMs(current.expiresAt, current.serverTime);
      const retryDue = current.retryAtMs !== undefined && now >= current.retryAtMs;
      const renewalDue = now >= renewalAt;
      if (!isAdoptedSessionAttended(current, now)) {
        if (current.renewalState !== 'paused') {
          store.set(adoptedSessionAtom, {
            ...current,
            renewalState: 'paused',
            isRenewalPaused: true,
          });
        }
        clearRenewTimer();
        const next = Math.min(
          current.tokenExpiresAtMs,
          current.hardDeadlineMonotonicMs ?? Number.POSITIVE_INFINITY,
        );
        if (Number.isFinite(next) && next > now) timeout = setTimeout(runRenew, next - now);
        return;
      }
      if (!renewalDue && !retryDue && now < current.tokenExpiresAtMs) {
        scheduleRenew();
        return;
      }
      renewing = true;
      clearRenewTimer();
      renewAdoptedSession({source: 'timer'})
        .catch(() => undefined)
        .finally(() => {
          renewing = false;
          if (!disposed) scheduleRenew();
        });
    };
    const wake = (event: 'focus' | 'blur' | 'visibility' | 'online') => {
      updateAdoptedAttendance(event);
      const current = store.get(adoptedSessionAtom);
      if (current === null) return;
      if (event === 'online' || event === 'focus' || event === 'visibility') {
        runRenew();
      } else {
        scheduleRenew();
      }
    };

    const onFocus = () => wake('focus');
    const onBlur = () => wake('blur');
    const onOnline = () => wake('online');
    const onVisibilityChange = () => wake('visibility');
    scheduleHardDeadline();
    scheduleRenew();
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      clearRenewTimer();
      clearDeadlineTimer();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    adoptedSession,
    effects,
    isAdoptedSessionAttended,
    releaseAdoptedSession,
    renewAdoptedSession,
    store,
    updateAdoptedAttendance,
  ]);

  if (bootError !== undefined && bootRecovery !== undefined) {
    return bootRecovery({error: bootError, retry: retryBoot});
  }

  return children;
}
