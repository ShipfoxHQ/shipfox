// @vitest-environment jsdom
import {
  ApiError,
  checkedApiRequest,
  configureApiClient,
  emptyResponseSchema,
  resetApiClient,
} from '@shipfox/client-api';
import {QueryClient} from '@tanstack/react-query';
import {act, cleanup, render, waitFor} from '@testing-library/react';
import {createStore} from 'jotai';
import type {AuthenticatedSession} from '#core/session.js';
import {
  type AdoptedSessionContinuationInput,
  type AdoptedSessionRenewal,
  type AdoptedSessionState,
  authStateAtom,
  useAdoptedSession,
  useAuthState,
  useAuthTransition,
} from './auth.js';
import {ShellProviderStack} from './provider-stack.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_SESSION: AuthenticatedSession = {
  accessToken: 'administrator-token',
  user: {id: ADMIN_ID, email: 'admin@example.com', adminRole: 'admin-owner'},
};
const TARGET_SESSION: AuthenticatedSession = {
  accessToken: 'target-token',
  user: {id: TARGET_ID, email: 'target@example.com'},
  impersonatorId: ADMIN_ID,
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function sessionResponse(session: AuthenticatedSession): Response {
  return jsonResponse({
    token: session.accessToken,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: null,
      email_verified_at: null,
      status: 'active',
      created_at: '2026-08-25T08:00:00.000Z',
      updated_at: '2026-08-25T08:00:00.000Z',
    },
    admin_role: session.user.adminRole ?? null,
    impersonator_id: session.impersonatorId ?? null,
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return input instanceof Request ? input.url : String(input);
}

function requestAuthorization(input: RequestInfo | URL): string | null {
  return input instanceof Request ? input.headers.get('authorization') : null;
}

interface HarnessApi {
  adoptSession: (
    session: AuthenticatedSession,
    options: {
      expiresAt: string;
      serverTime: string;
      hardDeadline?: string;
      continuity?: boolean;
      renew: (input?: AdoptedSessionContinuationInput) => Promise<{
        session: AuthenticatedSession;
        expiresAt: string;
        serverTime: string;
      } | null>;
      onRelease?: (reason: string) => void;
    },
  ) => Promise<boolean>;
  continueForRequest: (input: AdoptedSessionContinuationInput, force: boolean) => Promise<string>;
  renewAdoptedSession: (
    input?: AdoptedSessionContinuationInput,
  ) => Promise<AdoptedSessionRenewal | null>;
  releaseAdoptedSession: (reason?: 'manual-stop' | 'hard-deadline') => Promise<void>;
  adoptedSession: AdoptedSessionState | null;
  enterGuest: () => Promise<boolean>;
}

function Harness({apiRef}: {apiRef: {current: HarnessApi | null}}) {
  const {
    adoptSession,
    continueForRequest,
    renewAdoptedSession,
    releaseAdoptedSession,
    adoptedSession,
  } = useAdoptedSession();
  const {enterGuest} = useAuthTransition();
  apiRef.current = {
    adoptSession,
    continueForRequest,
    renewAdoptedSession,
    releaseAdoptedSession,
    adoptedSession,
    enterGuest,
  };
  return null;
}

function renderHarness(fetchImpl: typeof fetch, providedApiRef?: {current: HarnessApi | null}) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const store = createStore();
  const apiRef = providedApiRef ?? {current: null};
  resetApiClient();
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
  render(
    <ShellProviderStack
      features={[]}
      queryClient={queryClient}
      store={store}
      auth={{effects: true}}
    >
      <Harness apiRef={apiRef} />
    </ShellProviderStack>,
  );
  return {apiRef, store};
}

function setDocumentAttendance({visible, focused}: {visible: boolean; focused: boolean}): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  });
  vi.spyOn(document, 'hasFocus').mockReturnValue(focused);
}

function adoptionTimes(lifetimeMs = 60_000, deadlineMs = 10 * 60_000) {
  const serverTime = new Date().toISOString();
  return {
    serverTime,
    expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
    hardDeadline: new Date(Date.now() + deadlineMs).toISOString(),
  };
}

function useFakeTimersWithWaitFor(): void {
  vi.useFakeTimers();
  vi.stubGlobal('jest', vi);
}

describe('continuity-aware adopted sessions', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetApiClient();
  });

  test('restores a target at boot without making the ordinary snapshot ambient', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const seenTokens: string[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) {
        const authorization = requestAuthorization(input);
        if (authorization) seenTokens.push(authorization);
        return Promise.resolve(jsonResponse({memberships: []}));
      }
      return Promise.resolve(
        jsonResponse({message: 'Not found', code: 'not-found'}, {status: 404}),
      );
    });
    const targetTimes = adoptionTimes();
    const restorer = vi.fn(
      async ({
        getOrdinarySessionSnapshot,
      }: {
        getOrdinarySessionSnapshot: () => Promise<AuthenticatedSession>;
      }) => {
        const ordinary = await getOrdinarySessionSnapshot();
        expect(ordinary.user.id).toBe(ADMIN_ID);
        return {
          session: TARGET_SESSION,
          options: {
            ...targetTimes,
            renew: vi.fn(async () => null),
          },
        };
      },
    );
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const store = createStore();
    const seenStates: string[] = [];
    function Probe() {
      const auth = useAuthState();
      if (auth.status !== 'loading' && auth.token) seenStates.push(auth.token);
      return null;
    }

    resetApiClient();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    render(
      <ShellProviderStack
        features={[]}
        queryClient={queryClient}
        store={store}
        auth={{effects: true, bootRestorer: restorer}}
      >
        <Probe />
      </ShellProviderStack>,
    );

    await waitFor(() => expect(store.get(authStateAtom).token).toBe(TARGET_SESSION.accessToken));
    expect(restorer).toHaveBeenCalledOnce();
    expect(seenStates).toContain(TARGET_SESSION.accessToken);
    expect(seenStates).not.toContain(ADMIN_SESSION.accessToken);
    expect(seenTokens).toEqual([`Bearer ${TARGET_SESSION.accessToken}`]);
  });

  test('renders an explicit boot recovery decision without entering a principal', async () => {
    const recoveryError = new Error('window needs recovery');
    let receivedError: unknown;
    const restorer = vi.fn(() => ({type: 'recovery', error: recoveryError}));
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({memberships: []})));
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const store = createStore();

    resetApiClient();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    render(
      <ShellProviderStack
        features={[]}
        queryClient={queryClient}
        store={store}
        auth={{
          effects: true,
          bootRestorer: restorer,
          bootRecovery: ({error}) => {
            receivedError = error;
            return <div data-testid="boot-recovery" />;
          },
        }}
      >
        <div data-testid="app" />
      </ShellProviderStack>,
    );

    await waitFor(() => expect(receivedError).toBe(recoveryError));
    expect(store.get(authStateAtom).status).toBe('loading');
    expect(restorer).toHaveBeenCalledOnce();
  });

  test('surfaces retryable boot failures and retries without entering a principal', async () => {
    const restorationError = new Error('temporary restoration failure');
    let retryBoot: (() => void) | undefined;
    let recoveryError: unknown;
    let attempts = 0;
    const restorer = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw restorationError;
      return {type: 'guest'};
    });
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({memberships: []})));
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const store = createStore();

    resetApiClient();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    render(
      <ShellProviderStack
        features={[]}
        queryClient={queryClient}
        store={store}
        auth={{
          effects: true,
          bootRestorer: restorer,
          bootRecovery: ({error, retry}) => {
            recoveryError = error;
            retryBoot = retry;
            return <div data-testid="boot-recovery" />;
          },
        }}
      >
        <div data-testid="app" />
      </ShellProviderStack>,
    );

    await waitFor(() => expect(recoveryError).toBe(restorationError));
    expect(store.get(authStateAtom).status).toBe('loading');
    expect(retryBoot).toEqual(expect.any(Function));

    await act(async () => retryBoot?.());
    await waitFor(() => expect(store.get(authStateAtom).status).toBe('guest'));
    expect(restorer).toHaveBeenCalledTimes(2);
  });

  test('does not rerun boot when the restorer identity changes after retry', async () => {
    const restorationError = new Error('temporary restoration failure');
    const firstRestorer = vi
      .fn()
      .mockImplementationOnce(() => {
        throw restorationError;
      })
      .mockImplementation(() => ({type: 'guest'}));
    const secondRestorer = vi.fn(() => ({type: 'guest'}));
    let retryBoot: (() => void) | undefined;
    let recoveryError: unknown;
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({memberships: []})));
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
    const store = createStore();

    function BootApp({version}: {version: number}) {
      const bootRestorer = version === 0 ? firstRestorer : secondRestorer;
      return (
        <ShellProviderStack
          features={[]}
          queryClient={queryClient}
          store={store}
          auth={{
            effects: true,
            bootRestorer,
            bootRecovery: ({error, retry}) => {
              recoveryError = error;
              retryBoot = retry;
              return <div data-testid="boot-recovery" />;
            },
          }}
        >
          <div data-testid="app" />
        </ShellProviderStack>
      );
    }

    resetApiClient();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const {rerender} = render(<BootApp version={0} />);

    await waitFor(() => expect(recoveryError).toBe(restorationError));
    await act(async () => retryBoot?.());
    await waitFor(() => expect(store.get(authStateAtom).status).toBe('guest'));
    expect(firstRestorer).toHaveBeenCalledTimes(2);

    await act(async () => rerender(<BootApp version={1} />));
    expect(secondRestorer).not.toHaveBeenCalled();
  });

  test('requires a hard deadline when continuity is explicitly enabled', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));
    const times = adoptionTimes(-1);
    const withoutDeadline = {expiresAt: times.expiresAt, serverTime: times.serverTime};
    const api = apiRef.current;
    if (api === null) throw new Error('The auth harness was not mounted.');

    await expect(
      api.adoptSession(TARGET_SESSION, {
        ...withoutDeadline,
        continuity: true,
        renew: vi.fn(async () => null),
      }),
    ).rejects.toThrow('Continuity adoptions require valid hardDeadline and serverTime.');
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken);
  });

  test('requires a valid server time when continuity is explicitly enabled', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));
    const times = adoptionTimes(-1);
    const api = apiRef.current;
    if (api === null) throw new Error('The auth harness was not mounted.');

    await expect(
      api.adoptSession(TARGET_SESSION, {
        ...times,
        serverTime: 'not-a-timestamp',
        continuity: true,
        renew: vi.fn(async () => null),
      }),
    ).rejects.toThrow('Continuity adoptions require valid hardDeadline and serverTime.');
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken);
  });

  test('coalesces an adopted 401 recovery and retries once with the renewed target token', async () => {
    setDocumentAttendance({visible: true, focused: true});
    let widgetCalls = 0;
    let resolveRenewal:
      | ((value: {session: AuthenticatedSession; expiresAt: string; serverTime: string}) => void)
      | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      if (url.endsWith('/widgets')) {
        widgetCalls += 1;
        if (widgetCalls <= 2) {
          return Promise.resolve(
            jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
          );
        }
        return Promise.resolve(jsonResponse({}));
      }
      return Promise.resolve(
        jsonResponse({message: 'Not found', code: 'not-found'}, {status: 404}),
      );
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));
    const times = adoptionTimes();
    const renew = vi.fn(
      () =>
        new Promise<{
          session: AuthenticatedSession;
          expiresAt: string;
          serverTime: string;
        }>((resolve) => {
          resolveRenewal = resolve;
        }),
    );
    await act(async () => {
      await expect(
        apiRef.current?.adoptSession(TARGET_SESSION, {...times, continuity: true, renew}),
      ).resolves.toBe(true);
    });

    const firstRequest = checkedApiRequest(emptyResponseSchema, '/widgets');
    const secondRequest = checkedApiRequest(emptyResponseSchema, '/widgets');
    await new Promise((resolve) => setTimeout(resolve, 25));
    await waitFor(() => expect(renew).toHaveBeenCalledOnce());
    const renewedTimes = adoptionTimes(120_000);
    resolveRenewal?.({
      session: {...TARGET_SESSION, accessToken: 'renewed-target-token'},
      ...renewedTimes,
    });

    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(renew).toHaveBeenCalledOnce();
    expect(
      fetchImpl.mock.calls.filter(([input]) => requestUrl(input).endsWith('/widgets')),
    ).toHaveLength(4);
    const widgetRequests = fetchImpl.mock.calls.filter(([input]) =>
      requestUrl(input).endsWith('/widgets'),
    );
    expect(requestAuthorization(widgetRequests[0]?.[0] as Request)).toBe(
      `Bearer ${TARGET_SESSION.accessToken}`,
    );
    expect(requestAuthorization(widgetRequests[2]?.[0] as Request)).toBe(
      'Bearer renewed-target-token',
    );
  });

  test('a renewal for a different principal ends continuity without retrying', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    const times = adoptionTimes();
    const wrongPrincipalRenewal = {
      session: {
        ...TARGET_SESSION,
        accessToken: 'wrong-principal-token',
        user: ADMIN_SESSION.user,
      },
      ...adoptionTimes(120_000),
    };
    const renew = vi.fn(() => Promise.resolve(wrongPrincipalRenewal));
    const api = apiRef.current;
    if (api === null) throw new Error('The auth harness was not mounted.');
    await act(async () => {
      await expect(
        api.adoptSession(TARGET_SESSION, {...times, continuity: true, renew}),
      ).resolves.toBe(true);
    });

    await expect(api.continueForRequest({source: 'request'}, true)).rejects.toMatchObject({
      code: 'adopted-session-ended',
      status: 0,
      details: {reason: 'continuation-terminal'},
    });

    expect(renew).toHaveBeenCalledOnce();
    expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken);
  });

  test('does not return a continuation token after the request aborts', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    let resolveRenewal: ((value: AdoptedSessionRenewal | null) => void) | undefined;
    const renew = vi.fn(
      (_input?: AdoptedSessionContinuationInput) =>
        new Promise<AdoptedSessionRenewal | null>((resolve) => {
          resolveRenewal = resolve;
        }),
    );
    const times = adoptionTimes(-1);
    const api = apiRef.current;
    if (api === null) throw new Error('The auth harness was not mounted.');
    await act(async () => {
      await expect(
        api.adoptSession(TARGET_SESSION, {...times, continuity: true, renew}),
      ).resolves.toBe(true);
    });

    const abortError = new Error('Request aborted');
    const alreadyAborted = new AbortController();
    alreadyAborted.abort(abortError);
    await expect(
      api.continueForRequest({signal: alreadyAborted.signal, source: 'request'}, false),
    ).rejects.toBe(abortError);
    expect(renew).not.toHaveBeenCalled();

    const controller = new AbortController();
    const waitingRequest = api.continueForRequest(
      {signal: controller.signal, source: 'request'},
      false,
    );
    await waitFor(() => expect(renew).toHaveBeenCalledOnce());
    expect(renew).toHaveBeenCalledWith({signal: undefined, source: 'request'});

    const secondController = new AbortController();
    const secondRequest = api.continueForRequest(
      {signal: secondController.signal, source: 'request'},
      false,
    );

    controller.abort(abortError);
    await expect(waitingRequest).rejects.toBe(abortError);
    resolveRenewal?.({
      session: {...TARGET_SESSION, accessToken: 'renewed-target-token'},
      ...adoptionTimes(120_000),
    });
    await expect(secondRequest).resolves.toBe('renewed-target-token');
    expect(
      fetchImpl.mock.calls.filter(([input]) => requestUrl(input).endsWith('/widgets')),
    ).toHaveLength(0);

    await api.releaseAdoptedSession('manual-stop');
  });

  test('does not let a direct renewal signal cancel shared continuation', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    let resolveRenewal: ((value: AdoptedSessionRenewal | null) => void) | undefined;
    const renew = vi.fn((input?: AdoptedSessionContinuationInput) => {
      expect(input).toEqual({signal: undefined, source: 'manual'});
      return new Promise<AdoptedSessionRenewal | null>((resolve) => {
        resolveRenewal = resolve;
      });
    });
    const api = apiRef.current;
    if (api === null) throw new Error('The auth harness was not mounted.');
    await act(async () => {
      await expect(
        api.adoptSession(TARGET_SESSION, {...adoptionTimes(-1), continuity: true, renew}),
      ).resolves.toBe(true);
    });

    const abortError = new Error('Direct renewal aborted');
    const controller = new AbortController();
    const renewal = api.renewAdoptedSession({signal: controller.signal, source: 'manual'});
    await waitFor(() => expect(renew).toHaveBeenCalledOnce());
    controller.abort(abortError);
    await expect(renewal).rejects.toBe(abortError);

    resolveRenewal?.({
      session: {...TARGET_SESSION, accessToken: 'renewed-target-token'},
      ...adoptionTimes(120_000),
    });
    await waitFor(() => expect(store.get(authStateAtom).token).toBe('renewed-target-token'));
    await api.releaseAdoptedSession('manual-stop');
  });

  test('does not start direct renewal for an already-aborted signal', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    const renew = vi.fn(async () => null);
    const api = apiRef.current;
    if (api === null) throw new Error('The auth harness was not mounted.');
    await act(async () => {
      await expect(
        api.adoptSession(TARGET_SESSION, {...adoptionTimes(60_000), continuity: true, renew}),
      ).resolves.toBe(true);
    });

    const abortError = new Error('Direct renewal aborted before start');
    const controller = new AbortController();
    controller.abort(abortError);
    await expect(
      api.renewAdoptedSession({signal: controller.signal, source: 'manual'}),
    ).rejects.toBe(abortError);
    expect(renew).not.toHaveBeenCalled();

    await api.releaseAdoptedSession('manual-stop');
  });

  test('ends a hanging continuation at the hard deadline', async () => {
    useFakeTimersWithWaitFor();
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    const renew = vi.fn(() => new Promise<AdoptedSessionRenewal | null>(() => undefined));
    const api = apiRef.current;
    if (api === null) throw new Error('The auth harness was not mounted.');
    await act(async () => {
      await expect(
        api.adoptSession(TARGET_SESSION, {
          ...adoptionTimes(-1, 1_000),
          continuity: true,
          renew,
        }),
      ).resolves.toBe(true);
    });

    const continuationRejection = expect(
      api.continueForRequest({source: 'request'}, false),
    ).rejects.toMatchObject({
      code: 'adopted-session-ended',
      status: 0,
      details: {reason: 'hard-deadline'},
    });
    await waitFor(() => expect(renew).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(1_000);

    await continuationRejection;
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
  });

  test('releases a hidden continuity session at the hard deadline after token expiry', async () => {
    useFakeTimersWithWaitFor();
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    const reasons: string[] = [];
    await act(async () => {
      await expect(
        apiRef.current?.adoptSession(TARGET_SESSION, {
          ...adoptionTimes(20, 100),
          continuity: true,
          renew: vi.fn(async () => null),
          onRelease: (reason) => reasons.push(reason),
        }),
      ).resolves.toBe(true);
    });

    setDocumentAttendance({visible: false, focused: false});
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(100);

    await waitFor(() => expect(reasons).toEqual(['hard-deadline']));
    await waitFor(() => expect(apiRef.current?.adoptedSession).toBeNull());
  });

  test('does not retry a released adopted bearer with ordinary credentials', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const apiRef: {current: HarnessApi | null} = {current: null};
    let releasePromise: Promise<void> | undefined;
    let widgetCalls = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      if (url.endsWith('/widgets')) {
        widgetCalls += 1;
        if (releasePromise === undefined) {
          releasePromise = apiRef.current?.releaseAdoptedSession('manual-stop');
        }
        return Promise.resolve(
          jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    const {store} = renderHarness(fetchImpl, apiRef);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    await act(async () => {
      await expect(
        apiRef.current?.adoptSession(TARGET_SESSION, {
          ...adoptionTimes(60_000),
          continuity: true,
          renew: vi.fn(async () => null),
        }),
      ).resolves.toBe(true);
    });

    await expect(checkedApiRequest(emptyResponseSchema, '/widgets')).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });
    expect(releasePromise).toBeDefined();
    await releasePromise;
    expect(widgetCalls).toBe(1);
  });

  test.each([
    {
      label: 'an invalid issuer lifetime',
      getExpiresAt: (times: ReturnType<typeof adoptionTimes>) => times.serverTime,
      delayMs: 20,
    },
    {
      label: 'a known issuer lifetime after it has elapsed',
      getExpiresAt: (times: ReturnType<typeof adoptionTimes>) => times.expiresAt,
      delayMs: 20,
    },
  ])('does not replay a delayed released bearer with the administrator credential after $label', async ({
    getExpiresAt,
    delayMs,
  }) => {
    useFakeTimersWithWaitFor();
    setDocumentAttendance({visible: true, focused: true});
    let resolveInitialResponse: ((response: Response) => void) | undefined;
    let releasePromise: Promise<void> | undefined;
    let widgetCalls = 0;
    let refreshCalls = 0;
    const apiRef: {current: HarnessApi | null} = {current: null};
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(sessionResponse(ADMIN_SESSION));
      }
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      if (url.endsWith('/widgets')) {
        widgetCalls += 1;
        if (widgetCalls === 1) {
          releasePromise = apiRef.current?.releaseAdoptedSession('manual-stop');
          return new Promise<Response>((resolve) => {
            resolveInitialResponse = resolve;
          });
        }
        return Promise.resolve(jsonResponse({}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    const {store} = renderHarness(fetchImpl, apiRef);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    const times = adoptionTimes(10);
    await act(async () => {
      await expect(
        apiRef.current?.adoptSession(TARGET_SESSION, {
          ...times,
          expiresAt: getExpiresAt(times),
          renew: vi.fn(async () => null),
        }),
      ).resolves.toBe(true);
    });

    const request = checkedApiRequest(emptyResponseSchema, '/widgets');
    await waitFor(() => expect(widgetCalls).toBe(1));
    expect(releasePromise).toBeDefined();
    await releasePromise;
    const refreshCallsAfterRelease = refreshCalls;
    await vi.advanceTimersByTimeAsync(delayMs);
    resolveInitialResponse?.(
      jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
    );

    await expect(request).rejects.toMatchObject({code: 'unauthorized', status: 401});
    expect(widgetCalls).toBe(1);
    expect(refreshCalls).toBe(refreshCallsAfterRelease);
  });

  test('does not retry a superseded adopted bearer after renewal and release', async () => {
    setDocumentAttendance({visible: true, focused: true});
    let resolveInitialResponse: ((response: Response) => void) | undefined;
    let widgetCalls = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      if (url.endsWith('/widgets')) {
        widgetCalls += 1;
        if (widgetCalls === 1) {
          return new Promise<Response>((resolve) => {
            resolveInitialResponse = resolve;
          });
        }
        return Promise.resolve(jsonResponse({}));
      }
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    const renewal = {
      session: {...TARGET_SESSION, accessToken: 'renewed-target-token'},
      ...adoptionTimes(120_000),
    };
    const renew = vi.fn(async () => renewal);
    await act(async () => {
      await expect(
        apiRef.current?.adoptSession(TARGET_SESSION, {
          ...adoptionTimes(60_000),
          continuity: true,
          renew,
        }),
      ).resolves.toBe(true);
    });

    const request = checkedApiRequest(emptyResponseSchema, '/widgets');
    await waitFor(() => expect(widgetCalls).toBe(1));
    await expect(apiRef.current?.renewAdoptedSession({source: 'manual'})).resolves.toEqual(renewal);
    await expect(apiRef.current?.releaseAdoptedSession('manual-stop')).resolves.toBeUndefined();

    resolveInitialResponse?.(
      jsonResponse({message: 'Unauthorized', code: 'unauthorized'}, {status: 401}),
    );
    await expect(request).rejects.toMatchObject({code: 'unauthorized', status: 401});
    expect(widgetCalls).toBe(1);
  });

  test('a failed release restore cannot evict a newer adoption', async () => {
    setDocumentAttendance({visible: true, focused: true});
    let refreshCalls = 0;
    let rejectReleaseRestore: ((error: unknown) => void) | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        if (refreshCalls === 1) return Promise.resolve(sessionResponse(ADMIN_SESSION));
        return new Promise<Response>((_, reject) => {
          rejectReleaseRestore = reject;
        });
      }
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    await act(async () => {
      await expect(
        apiRef.current?.adoptSession(TARGET_SESSION, {
          ...adoptionTimes(60_000),
          continuity: true,
          renew: vi.fn(async () => null),
        }),
      ).resolves.toBe(true);
    });

    const releasePromise = apiRef.current?.releaseAdoptedSession('manual-stop');
    await waitFor(() => expect(refreshCalls).toBe(2));

    const nextSession = {...TARGET_SESSION, accessToken: 'second-adopted-token'};
    await act(async () => {
      await expect(
        apiRef.current?.adoptSession(nextSession, {
          ...adoptionTimes(60_000),
          continuity: true,
          renew: vi.fn(async () => null),
        }),
      ).resolves.toBe(true);
    });

    rejectReleaseRestore?.(new TypeError('Failed to fetch'));
    await expect(releasePromise).resolves.toBeUndefined();
    expect(store.get(authStateAtom).token).toBe(nextSession.accessToken);
    await waitFor(() =>
      expect(apiRef.current?.adoptedSession?.session.accessToken).toBe(nextSession.accessToken),
    );
  });

  test('honors nested rate-limit retry-after seconds before retrying continuation', async () => {
    useFakeTimersWithWaitFor();
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));

    let renewalCalls = 0;
    const renew = vi.fn(() => {
      renewalCalls += 1;
      if (renewalCalls === 1) {
        return Promise.reject(
          new ApiError({
            message: 'Rate limit exceeded',
            code: 'rate-limited',
            status: 429,
            details: {
              message: 'Rate limit exceeded',
              code: 'rate-limited',
              details: {retry_after_seconds: 7},
            },
          }),
        );
      }
      return Promise.resolve({
        session: {...TARGET_SESSION, accessToken: 'renewed-target-token'},
        ...adoptionTimes(120_000),
      });
    });
    const api = apiRef.current;
    if (api === null) throw new Error('The auth harness was not mounted.');
    await act(async () => {
      await expect(
        api.adoptSession(TARGET_SESSION, {
          ...adoptionTimes(-1),
          continuity: true,
          renew,
        }),
      ).resolves.toBe(true);
    });

    const continuation = api.continueForRequest({source: 'request'}, false);
    await waitFor(() => expect(renew).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(6_999);
    expect(renew).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1);
    await waitFor(() => expect(renew).toHaveBeenCalledTimes(2));
    await expect(continuation).resolves.toBe('renewed-target-token');
  });

  test('gates expired requests while the document is hidden', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const widgetFetch = vi.fn(() => Promise.resolve(jsonResponse({})));
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      if (url.endsWith('/widgets')) return widgetFetch();
      return Promise.resolve(
        jsonResponse({message: 'Not found', code: 'not-found'}, {status: 404}),
      );
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));
    const times = adoptionTimes(20, 60_000);
    await act(async () => {
      await apiRef.current?.adoptSession(TARGET_SESSION, {
        ...times,
        continuity: true,
        renew: vi.fn(async () => null),
      });
    });

    setDocumentAttendance({visible: false, focused: false});
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 30));

    await expect(checkedApiRequest(emptyResponseSchema, '/widgets')).rejects.toMatchObject({
      code: 'adopted-session-paused',
      status: 0,
    });
    expect(widgetFetch).not.toHaveBeenCalled();
  });

  test('delivers logout to the release callback once', async () => {
    setDocumentAttendance({visible: true, focused: true});
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));
    const reasons: string[] = [];
    await act(async () => {
      await apiRef.current?.adoptSession(TARGET_SESSION, {
        ...adoptionTimes(),
        continuity: true,
        renew: vi.fn(async () => null),
        onRelease: (reason) => reasons.push(reason),
      });
    });

    await apiRef.current?.enterGuest();
    await waitFor(() => expect(store.get(authStateAtom).status).toBe('guest'));
    await waitFor(() => expect(reasons).toEqual(['logout']));
  });

  test('rejects a request waiting for continuation when the adoption is released', async () => {
    setDocumentAttendance({visible: true, focused: true});
    let resolveRenewal: ((value: null) => void) | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.endsWith('/auth/refresh')) return Promise.resolve(sessionResponse(ADMIN_SESSION));
      if (url.endsWith('/workspaces')) return Promise.resolve(jsonResponse({memberships: []}));
      return Promise.resolve(jsonResponse({}));
    });
    const {apiRef, store} = renderHarness(fetchImpl);
    await waitFor(() => expect(store.get(authStateAtom).token).toBe(ADMIN_SESSION.accessToken));
    const times = adoptionTimes(-1, 60_000);
    const renew = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveRenewal = resolve;
        }),
    );
    await act(async () => {
      await apiRef.current?.adoptSession(TARGET_SESSION, {...times, continuity: true, renew});
    });

    const waitingRequest = checkedApiRequest(emptyResponseSchema, '/widgets');
    await new Promise((resolve) => setTimeout(resolve, 25));
    await waitFor(() => expect(renew).toHaveBeenCalledOnce());
    await apiRef.current?.releaseAdoptedSession('manual-stop');
    await expect(waitingRequest).rejects.toMatchObject({
      code: 'adopted-session-ended',
      status: 0,
      details: {reason: 'manual-stop'},
    });
    resolveRenewal?.(null);
  });
});
