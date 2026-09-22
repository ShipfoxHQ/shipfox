import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-shell/runtime';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import {createStore, Provider as JotaiProvider} from 'jotai';
import {
  workflowRunFixtureDto,
  workflowRunOverviewResponseDto,
} from '#test/fixtures/workflow-run.js';
import permalinkRoute from './run-permalink.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function createPermalinkRouter(path: string) {
  const rootRoute = createRootRoute({component: Outlet});
  const permalink = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$workflowRunId',
    ...permalinkRoute.options,
  });
  const login = createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/login',
    component: () => <div>Login</div>,
  });
  const canonical = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => <div>Canonical run</div>,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([permalink, login, canonical]),
  });
}

function renderPermalink({
  auth,
  fetchImpl,
  path = `/runs/${RUN_ID}`,
}: {
  auth: AuthState;
  fetchImpl?: typeof fetch;
  path?: string;
}) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const router = createPermalinkRouter(path);
  const store = createStore();
  store.set(authStateAtom, auth);
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

  render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <RouterProvider router={router} />
      </JotaiProvider>
    </QueryClientProvider>,
  );

  return router;
}

function authenticatedAuth(workspaceId = WORKSPACE_ID): AuthState {
  return {
    status: 'authenticated',
    token: 'token',
    workspaces: [{id: workspaceId, name: 'Acme', slug: 'acme', membershipId: 'membership-1'}],
  };
}

function permalinkFetch() {
  const overview = workflowRunOverviewResponseDto(
    workflowRunFixtureDto({id: RUN_ID, project_id: PROJECT_ID}),
  );
  const project = {
    id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    name: 'Payments',
    slug: 'payments',
    source: {
      connection_id: '44444444-4444-4444-8444-444444444444',
      external_repository_id: 'shipfox/payments',
    },
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:00:00.000Z',
  };
  return vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const pathname = new URL(input instanceof Request ? input.url : input.toString()).pathname;
    if (pathname.endsWith('/head')) {
      return Promise.resolve(
        jsonResponse({
          current_attempt: 1,
          latest_attempt: 1,
          current_status: 'running',
          updated_at: '2026-06-21T12:01:00.000Z',
        }),
      );
    }
    if (pathname.endsWith('/overview')) return Promise.resolve(jsonResponse(overview));
    if (pathname.endsWith(`/projects/${PROJECT_ID}`)) return Promise.resolve(jsonResponse(project));
    return Promise.reject(new Error(`Unexpected request: ${pathname}`));
  });
}

describe('run permalink route', () => {
  afterEach(() => {
    cleanup();
    configureApiClient({baseUrl: '', fetchImpl: undefined});
  });

  test('sends a guest to login with the permalink as the return target', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const router = renderPermalink({auth: {status: 'guest'}, fetchImpl});

    await waitFor(() => expect(router.state.location.pathname).toBe('/auth/login'));
    expect(router.state.location.search).toEqual({redirect: `/runs/${RUN_ID}`});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('renders a not-found page when the run cannot be read', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({code: 'not-found'}, {status: 404}),
    );
    renderPermalink({auth: authenticatedAuth(), fetchImpl});

    expect(await screen.findByText('Run not found')).toBeInTheDocument();
  });

  test('renders a no-access page when the project workspace is absent from the session', async () => {
    renderPermalink({auth: authenticatedAuth('other-workspace'), fetchImpl: permalinkFetch()});

    expect(await screen.findByText('You do not have access to this run')).toBeInTheDocument();
  });

  test('redirects an accessible run to its canonical project URL', async () => {
    const router = renderPermalink({auth: authenticatedAuth(), fetchImpl: permalinkFetch()});

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/w/acme/p/payments/runs/${RUN_ID}`),
    );
  });
});
