import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {type RenderResult, render} from '@testing-library/react';
import type {ReactElement} from 'react';

// The lightweight middle tier between a plain `render()` and the page harness
// (`test/pages.tsx`). Use it for a component that only needs a router in context
// (its rows render `<Link>`, or it calls `useNavigate`) but does not fetch: it
// mounts the element with a memory router and no QueryClient or API client.
//
// The run-detail route is registered so `<Link to=".../runs/$workflowRunId">`
// resolves to a real href. Add more link-target routes here as router-only
// components need them, rather than reaching for the page harness.
function createComponentRouter(element: ReactElement) {
  const rootRoute = createRootRoute({component: Outlet});
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => element,
  });
  const runDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid/runs/$workflowRunId',
    component: () => null,
  });

  return createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute.addChildren([indexRoute, runDetailRoute]),
  });
}

export function renderWithRouter(
  element: ReactElement,
): RenderResult & {router: ReturnType<typeof createComponentRouter>} {
  const router = createComponentRouter(element);

  const result = render(<RouterProvider router={router} />);

  return Object.assign(result, {router});
}
