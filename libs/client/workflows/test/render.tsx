import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {type RenderResult, render} from '@testing-library/react';
import {cloneElement, type ReactElement} from 'react';

interface RenderedRun {
  origin?: string | null;
}

interface RenderedListProps {
  runs?: readonly RenderedRun[];
  search?: unknown;
}

/**
 * Row-focused fixtures often contain only development runs. Keep those tests on the development
 * scope explicitly because the dashboard defaults to synced runs; mixed fixtures still exercise
 * the default scope.
 */
function scopeDevelopmentOnlyList(element: ReactElement): ReactElement {
  const props = element.props as unknown as RenderedListProps;
  const runs = props.runs;

  if (
    props.search === undefined &&
    runs !== undefined &&
    runs.length > 0 &&
    runs.every((run) => run.origin === 'dev')
  ) {
    return cloneElement(element, {search: {origin: 'dev'}} as never);
  }

  return element;
}

function createComponentRouter(element: ReactElement) {
  const rootRoute = createRootRoute({component: Outlet});
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => scopeDevelopmentOnlyList(element),
  });
  // Workflow run rows link here; TanStack Router needs the target route to build hrefs.
  const runDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => null,
  });
  const jobDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
    component: () => null,
  });
  // The unfiltered empty state links here.
  const workflowsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/workflows',
    component: () => null,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute.addChildren([indexRoute, runDetailRoute, jobDetailRoute, workflowsRoute]),
  });
}

export function renderWithRouter(
  element: ReactElement,
): RenderResult & {router: ReturnType<typeof createComponentRouter>} {
  const router = createComponentRouter(element);

  const result = render(<RouterProvider router={router} />);

  return Object.assign(result, {router});
}
