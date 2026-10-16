import {configureApiClient} from '@shipfox/client-api';
import {createShellQueryClient} from '@shipfox/client-shell/runtime';
import {QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
} from '@tanstack/react-router';
import {render, screen} from '@testing-library/react';
import {jsonResponse, requestUrl} from '#test/utils.js';
import {PasswordLoginGate} from './password-login-gate.js';

const LOGIN_HEADING_RE = /^Login at/;

function LoginLocation() {
  const href = useRouterState({select: (state) => state.location.href});
  return <h1>Login at {href}</h1>;
}

function renderGate(path: string) {
  const rootRoute = createRootRoute({component: Outlet});
  const signupRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/signup',
    component: () => (
      <PasswordLoginGate>
        <h1>Signup form</h1>
      </PasswordLoginGate>
    ),
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/login',
    component: LoginLocation,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([signupRoute, loginRoute]),
  });
  render(
    <QueryClientProvider
      client={createShellQueryClient({defaultOptions: {queries: {retry: false}}})}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function loginMethodsFetch(response: () => Response) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = requestUrl(input);
    if (url === 'https://api.example.test/auth/login-methods') return response();
    throw new Error(`Unexpected request: ${url}`);
  });
}

describe('PasswordLoginGate', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', getAccessToken: undefined});
  });

  test('renders the page when the server offers password login', async () => {
    configureApiClient({
      fetchImpl: loginMethodsFetch(() =>
        jsonResponse({login_methods: [{id: 'password'}, {id: 'oauth:github'}]}),
      ),
    });

    renderGate('/auth/signup');

    expect(await screen.findByRole('heading', {name: 'Signup form'})).toBeInTheDocument();
  });

  test('redirects to login and keeps the redirect when password login is off', async () => {
    configureApiClient({
      fetchImpl: loginMethodsFetch(() => jsonResponse({login_methods: [{id: 'oauth:github'}]})),
    });
    const redirect = '/invitations/accept?token=invite-token';

    renderGate(`/auth/signup?redirect=${encodeURIComponent(redirect)}`);

    const heading = await screen.findByRole('heading', {name: LOGIN_HEADING_RE});
    expect(heading).toHaveTextContent(`/auth/login?redirect=${encodeURIComponent(redirect)}`);
  });

  test('renders the page when the login methods lookup fails', async () => {
    configureApiClient({
      fetchImpl: loginMethodsFetch(() =>
        jsonResponse({code: 'internal', message: 'Internal error'}, {status: 500}),
      ),
    });

    renderGate('/auth/signup');

    expect(await screen.findByRole('heading', {name: 'Signup form'})).toBeInTheDocument();
  });
});
