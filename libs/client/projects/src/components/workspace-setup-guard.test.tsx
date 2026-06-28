// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {configureApiClient} from '@shipfox/client-api';
import {integrationsQueryKeys} from '@shipfox/client-integrations';
import {FullPageLoader} from '@shipfox/react-ui';
import {QueryClient} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouteContext,
} from '@tanstack/react-router';
import {render, screen, waitFor} from '@testing-library/react';
import {projectsQueryKeys} from '#hooks/api/projects.js';
import {
  loadWorkspaceSetupRoute,
  WorkspaceSetupErrorRoute,
  type WorkspaceSetupState,
} from './workspace-setup-guard.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

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

function renderSetupRoute(
  path: string,
  fetchImpl: ReturnType<typeof setupFetch>,
  options: {seedQueryClient?: (queryClient: QueryClient) => void} = {},
) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  options.seedQueryClient?.(queryClient);

  const rootRoute = createRootRouteWithContext<{queryClient: QueryClient}>()({
    component: Outlet,
  });
  const guardedRoute = (routePath: string, label: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: routePath,
      beforeLoad: ({context, location, params}) =>
        loadWorkspaceSetupRoute({
          queryClient: context.queryClient,
          workspaceId: (params as {wid: string}).wid,
          pathname: location.pathname,
        }),
      pendingComponent: FullPageLoader,
      errorComponent: WorkspaceSetupErrorRoute,
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
    defaultPendingMs: 0,
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree,
    context: {queryClient},
  });

  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

  return render(<RouterProvider router={router} context={{queryClient}} />);
}

function GuardedRoute({label}: {label: string}) {
  const setupState = useRouteContext({strict: false}) as WorkspaceSetupState;

  return (
    <>
      <div data-testid="project-navigation">
        {setupState.hideProjectNavigation ? 'hidden' : 'visible'}
      </div>
      <main>{label}</main>
    </>
  );
}

function projectStub() {
  return {id: 'project-1', workspace_id: WORKSPACE_ID, name: 'Platform'};
}

function calledUrls(fetchImpl: ReturnType<typeof setupFetch>) {
  return fetchImpl.mock.calls.map(([input]) =>
    input instanceof Request ? input.url : String(input),
  );
}

describe('workspace setup route hook', () => {
  test('renders a loader while the project existence query is pending', async () => {
    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, setupFetch({projectsPending: true}));

    expect(await screen.findByRole('status', {name: 'Loading'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });

  test('renders a retryable setup-status error when the project query fails', async () => {
    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, setupFetch({projectsFail: true}));

    expect(await screen.findByText('Could not load workspace setup')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });

  test('allows normal workspace content and skips source connections when a project exists', async () => {
    const fetchImpl = setupFetch({projects: [projectStub()]});

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
    expect(calledUrls(fetchImpl).some((url) => url.includes('/integration-connections?'))).toBe(
      false,
    );
  });

  test('keeps cached completed-workspace state when the project refetch fails', async () => {
    const fetchImpl = setupFetch({projectsFail: true});

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl, {
      seedQueryClient: (queryClient) => {
        queryClient.setQueryData(projectsQueryKeys.exists(WORKSPACE_ID), {
          projects: [projectStub()],
          next_cursor: null,
        });
      },
    });

    expect(await screen.findByText('Workspace home')).toBeInTheDocument();
    await waitFor(() =>
      expect(calledUrls(fetchImpl).some((url) => url.includes('/projects?'))).toBe(true),
    );
    expect(screen.queryByText('Could not load workspace setup')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
  });

  test('sends a workspace with no active VCS to source-control onboarding', async () => {
    const fetchImpl = setupFetch({
      connections: [sourceConnection({lifecycle_status: 'disabled'})],
    });

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl);

    expect(await screen.findByText('VCS onboarding')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('sends a workspace with active VCS and no project to project creation', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/integrations`,
      setupFetch({connections: [sourceConnection()]}),
    );

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('keeps cached source-connection state when the source refetch fails', async () => {
    const fetchImpl = setupFetch({connectionsFail: true});

    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, fetchImpl, {
      seedQueryClient: (queryClient) => {
        queryClient.setQueryData(integrationsQueryKeys.sourceConnections(WORKSPACE_ID), {
          connections: [sourceConnection()],
        });
      },
    });

    expect(await screen.findByText('Create project')).toBeInTheDocument();
    await waitFor(() =>
      expect(calledUrls(fetchImpl).some((url) => url.includes('/integration-connections?'))).toBe(
        true,
      ),
    );
    expect(screen.queryByText('Could not load workspace setup')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('hidden');
  });

  test('redirects the completed workspace integrations index to settings integrations', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/integrations`,
      setupFetch({projects: [projectStub()]}),
    );

    expect(await screen.findByText('Settings integrations')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
  });

  test('keeps completed workspace integration install routes available', async () => {
    renderSetupRoute(
      `/workspaces/${WORKSPACE_ID}/integrations/debug`,
      setupFetch({projects: [projectStub()]}),
    );

    expect(await screen.findByText('Debug install')).toBeInTheDocument();
    expect(screen.getByTestId('project-navigation')).toHaveTextContent('visible');
  });

  test('renders a retryable setup-status error when the source connection query fails', async () => {
    renderSetupRoute(`/workspaces/${WORKSPACE_ID}`, setupFetch({connectionsFail: true}));

    expect(await screen.findByText('Could not load workspace setup')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeInTheDocument();
    expect(screen.queryByText('Workspace home')).not.toBeInTheDocument();
  });
});
