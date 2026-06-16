import {configureApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom} from '@shipfox/client-auth';
import {Toaster} from '@shipfox/react-ui';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router';
import {type RenderResult, render} from '@testing-library/react';
import {Provider as JotaiProvider, useSetAtom} from 'jotai';
import {type ReactElement, useEffect} from 'react';
import {CreateProjectPage} from '#pages/create-project-page.js';
import {ProjectRunsPage} from '#pages/project-runs-page.js';
import {ProjectWorkflowsPage} from '#pages/project-workflows-page.js';
import {ProjectsHubPage} from '#pages/projects-hub-page.js';

// All test renders that exercise pages requiring `useActiveWorkspace()` mount
// under `/workspaces/$wid`. The seeded workspace id (see authState) is the wid
// used in routes.
export const PROJECT_TEST_WID = '11111111-1111-4111-8111-111111111111';

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
  workspaces: [{id: PROJECT_TEST_WID, name: 'Acme', membershipId: 'm-1'}],
};

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function createTestRouter(path: string, element: ReactElement) {
  const initialPath = path.split('?')[0] ?? path;
  const rootRoute = createRootRoute({component: Outlet});
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (initialPath === '/' ? element : <ProjectsHubPage />),
  });
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid',
    component: () =>
      initialPath === `/workspaces/${PROJECT_TEST_WID}` ? element : <ProjectsHubPage />,
  });
  const workspaceNewProjectRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/new',
    component: () =>
      initialPath === `/workspaces/${PROJECT_TEST_WID}/projects/new` ? (
        element
      ) : (
        <CreateProjectPage />
      ),
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/integrations',
    component: () => <div>Integrations gallery placeholder</div>,
  });
  const projectDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid',
    component: () => {
      const params = useParams({strict: false}) as {pid?: string};
      if (initialPath === `/workspaces/${PROJECT_TEST_WID}/projects/${params.pid}`) {
        return element;
      }

      return <ProjectRunsPage projectId={params.pid ?? 'p-1'} />;
    },
  });
  const projectRunsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid/runs',
    component: Outlet,
  });
  const projectRunsIndexRoute = createRoute({
    getParentRoute: () => projectRunsRoute,
    path: '/',
    component: () => {
      const params = useParams({strict: false}) as {pid?: string};
      if (initialPath === `/workspaces/${PROJECT_TEST_WID}/projects/${params.pid}/runs`) {
        return element;
      }

      return <ProjectRunsPage projectId={params.pid ?? 'p-1'} />;
    },
  });
  const projectWorkflowRunRoute = createRoute({
    getParentRoute: () => projectRunsRoute,
    path: '$rid',
    component: () => {
      const params = useParams({strict: false}) as {pid?: string; rid?: string};
      if (
        initialPath === `/workspaces/${PROJECT_TEST_WID}/projects/${params.pid}/runs/${params.rid}`
      ) {
        return element;
      }

      return <div>Run detail route {params.rid}</div>;
    },
  });
  const projectWorkflowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid/workflows',
    component: () => {
      const params = useParams({strict: false}) as {pid?: string};
      if (initialPath === `/workspaces/${PROJECT_TEST_WID}/projects/${params.pid}/workflows`) {
        return element;
      }

      return <ProjectWorkflowsPage projectId={params.pid ?? 'p-1'} />;
    },
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([
      indexRoute,
      workspaceRoute,
      workspaceNewProjectRoute,
      integrationsRoute,
      projectDetailRoute,
      projectRunsRoute.addChildren([projectRunsIndexRoute, projectWorkflowRunRoute]),
      projectWorkflowsRoute,
    ]),
  });
}

function AuthSeed() {
  const setAuth = useSetAtom(authStateAtom);

  useEffect(() => {
    setAuth(authState);
  }, [setAuth]);

  return null;
}

export function renderProjectPage(path: string, element: ReactElement): RenderResult {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const router = createTestRouter(path, element);

  configureApiClient({baseUrl: 'https://api.example.test'});

  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider>
        <AuthSeed />
        <RouterProvider router={router} />
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>,
  );
}
