// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-auth';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {render, screen} from '@testing-library/react';
import {Provider as JotaiProvider, useSetAtom} from 'jotai';
import {useEffect} from 'react';
import {WorkspaceSetupGuard} from './workspace-setup-guard.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  user: {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'user@example.com',
    name: null,
    email_verified_at: new Date().toISOString(),
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  workspaces: [{id: WORKSPACE_ID, name: 'Acme', membershipId: 'm-1'}],
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function sourceConnection(overrides: {lifecycle_status?: string} = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    workspace_id: WORKSPACE_ID,
    provider: 'github',
    external_account_id: 'acct',
    display_name: 'GitHub',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

interface SetupFetchOptions {
  projects?: unknown[];
  connections?: unknown[];
  projectsFail?: boolean;
  connectionsFail?: boolean;
  projectsPending?: boolean;
}

function setupFetch(options: SetupFetchOptions = {}) {
  const {
    projects = [],
    connections = [],
    projectsFail = false,
    connectionsFail = false,
    projectsPending = false,
  } = options;

  return vi.fn((input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/projects?')) {
      if (projectsPending) return new Promise<Response>(() => undefined);
      if (projectsFail) return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(jsonResponse({projects, next_cursor: null}));
    }
    if (url.includes('/integration-connections?')) {
      if (connectionsFail)
        return Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}));
      return Promise.resolve(jsonResponse({connections}));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  });
}

function renderGuardPage(path: string, fetchImpl: ReturnType<typeof setupFetch>) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const rootRoute = createRootRoute({component: Outlet});
  const guardedRoute = (routePath: string, label: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      component: () => <GuardedRoute label={label} />,
    });
  const routeTree = rootRoute.addChildren([
    guardedRoute('/workspaces/$wid', 'Workspace home'),
    guardedRoute('/workspaces/$wid/integrations', 'VCS onboarding'),
    guardedRoute('/workspaces/$wid/integrations/debug', 'Debug install'),
    guardedRoute('/workspaces/$wid/projects/new', 'Create project'),
    guardedRoute('/workspaces/$wid/settings/integrations', 'Settings integrations'),
  ]);
  const router = createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree,
  });

  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <AuthSeed />
        <RouterProvider router={router} />
      </JotaiProvider>
    </QueryClientProvider>,
  );
}

function GuardedRoute({label}: {label: string}) {
  return (
    <WorkspaceSetupGuard>
      {({hideProjectNavigation}) => (
        <>
          <div data-testid="project-navigation">{hideProjectNavigation ? 'hidden' : 'visible'}</div>
          <main>{label}</main>
        </>
      )}
    </WorkspaceSetupGuard>
  );
}

function AuthSeed() {
  const setAuth = useSetAtom(authStateAtom);

  useEffect(() => {
    setAuth(authState);
  }, [setAuth]);

  return null;
}

function projectStub() {
  return {id: 'project-1', workspace_id: WORKSPACE_ID, name: 'Platform'};
}

function calledUrls(fetchImpl: ReturnType<typeof setupFetch>) {
  return fetchImpl.mock.calls.map(([input]) =>
    input instanceof Request ? input.url : String(input),
  );
}

describe('WorkspaceSetupGuard', () => {
  test('renders a loader while the project existence query is pending', async () => {
    renderGuardPage(`/workspaces/${WORKSPACE_ID}`, setupFetch({projectsPending: true}));

    expect(await screen.findByRole('status', {name: 'Loading'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });

  test('renders a retryable setup-status error when the project query fails', async () => {
    renderGuardPage(`/workspaces/${WORKSPACE_ID}`, setupFetch({projectsFail: true}));

    expect(await screen.findByText('Could not load workspace setup')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });

  test('allows normal workspace content and skips source connections when a project exists', async () => {
    const fetchImpl = setupFetch({projects: [projectStub()]});

    renderGuardPage(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
    expect(calledUrls(fetchImpl).some((url) => url.includes('/integration-connections?'))).toBe(
      false,
    );
  });

  test('sends a workspace with no active VCS to source-control onboarding', async () => {
    const fetchImpl = setupFetch({
      connections: [sourceConnection({lifecycle_status: 'disabled'})],
    });

    renderGuardPage(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('VCS onboarding')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('sends a workspace with active VCS and no project to project creation', async () => {
    renderGuardPage(
      `/workspaces/${WORKSPACE_ID}/integrations`,
      setupFetch({connections: [sourceConnection()]}),
    );

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('redirects the completed workspace integrations index to settings integrations', async () => {
    renderGuardPage(
      `/workspaces/${WORKSPACE_ID}/integrations`,
      setupFetch({projects: [projectStub()]}),
    );

    expect(await screen.findByText('Settings integrations')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
  });

  test('keeps completed workspace integration install routes available', async () => {
    renderGuardPage(
      `/workspaces/${WORKSPACE_ID}/integrations/debug`,
      setupFetch({projects: [projectStub()]}),
    );

    expect(await screen.findByText('Debug install')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
  });

  test('renders a retryable setup-status error when the source connection query fails', async () => {
    renderGuardPage(`/workspaces/${WORKSPACE_ID}`, setupFetch({connectionsFail: true}));

    expect(await screen.findByText('Could not load workspace setup')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });
});
