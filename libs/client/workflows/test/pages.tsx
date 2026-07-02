import {configureApiClient} from '@shipfox/client-api';
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
import type {ReactElement} from 'react';

// The workflow run page navigates with the router (run rows are links and the page redirects
// to the first run), so the harness mounts the page under a memory router whose route tree
// carries the `/workspaces/$wid/projects/$pid/runs/$workflowRunId` params the components read. The
// page is supplied as a factory the detail route calls with the current `workflowRunId`, mirroring
// the real route wiring so a redirect re-renders the page with the run it landed on.
export const PROJECT_TEST_WID = '11111111-1111-4111-8111-111111111111';

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function createTestRouter(
  path: string,
  renderPage: (params: {workflowRunId?: string | undefined}) => ReactElement,
) {
  const rootRoute = createRootRoute({component: Outlet});
  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid/runs',
    component: () => renderPage({}),
  });
  const runDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid/runs/$workflowRunId',
    component: function RunDetailRoute() {
      const {workflowRunId} = useParams({strict: false}) as {workflowRunId?: string};
      return renderPage({workflowRunId});
    },
  });
  const modelProviderSettingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/settings/model-providers',
    component: () => <div>Model provider settings placeholder</div>,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([runsRoute, runDetailRoute, modelProviderSettingsRoute]),
  });
}

export function renderProjectPage(
  path: string,
  renderPage: (params: {workflowRunId?: string | undefined}) => ReactElement,
): RenderResult & {
  queryClient: QueryClient;
  router: ReturnType<typeof createTestRouter>;
} {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const router = createTestRouter(path, renderPage);

  configureApiClient({baseUrl: 'https://api.example.test'});

  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return Object.assign(result, {queryClient, router});
}
