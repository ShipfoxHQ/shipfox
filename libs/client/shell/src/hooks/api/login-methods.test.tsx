import {configureApiClient} from '@shipfox/client-api';
import {onlineManager, QueryClientProvider} from '@tanstack/react-query';
import {renderHook, waitFor} from '@testing-library/react';
import type {PropsWithChildren} from 'react';
import {createShellQueryClient} from '#runtime/query-client.js';
import {loginMethodsQueryOptions, usePasswordLoginAvailability} from './login-methods.js';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function loginMethodsFetch(response: () => Response) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === 'https://api.example.test/auth/login-methods') return response();
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderAvailability() {
  const queryClient = createShellQueryClient({defaultOptions: {queries: {retry: false}}});
  const wrapper = ({children}: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => usePasswordLoginAvailability(), {wrapper});
}

describe('loginMethodsQueryOptions', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('returns the login method ids from the server', async () => {
    configureApiClient({
      fetchImpl: loginMethodsFetch(() =>
        jsonResponse({login_methods: [{id: 'password'}, {id: 'oauth:github'}]}),
      ),
    });
    const queryClient = createShellQueryClient({defaultOptions: {queries: {retry: false}}});

    const loginMethods = await queryClient.fetchQuery(loginMethodsQueryOptions());

    expect(loginMethods).toEqual(['password', 'oauth:github']);
  });
});

describe('usePasswordLoginAvailability', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  test('is available when the server offers password login', async () => {
    configureApiClient({
      fetchImpl: loginMethodsFetch(() => jsonResponse({login_methods: [{id: 'password'}]})),
    });

    const {result} = renderAvailability();

    await waitFor(() => expect(result.current).toBe('available'));
  });

  test('is unavailable when the server offers no password login', async () => {
    configureApiClient({
      fetchImpl: loginMethodsFetch(() => jsonResponse({login_methods: [{id: 'oauth:github'}]})),
    });

    const {result} = renderAvailability();

    await waitFor(() => expect(result.current).toBe('unavailable'));
  });

  test('is available when the lookup fails', async () => {
    configureApiClient({
      fetchImpl: loginMethodsFetch(() =>
        jsonResponse({code: 'internal', message: 'Internal error'}, {status: 500}),
      ),
    });

    const {result} = renderAvailability();

    await waitFor(() => expect(result.current).toBe('available'));
  });

  test('stays pending while the browser is offline', async () => {
    const fetchImpl = loginMethodsFetch(() => jsonResponse({login_methods: []}));
    configureApiClient({fetchImpl});
    onlineManager.setOnline(false);

    const {result} = renderAvailability();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toBe('pending');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
