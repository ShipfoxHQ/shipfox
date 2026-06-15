import type {RunDto} from '@shipfox/api-workflows-dto';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {render, screen} from '@testing-library/react';
import type {ReactElement} from 'react';
import {RelativeTimeProvider} from '#lib/relative-time.js';
import {PROJECT_TEST_WID} from '#test/pages.js';
import {RunRow} from './run-row.js';

function makeRun(overrides: Partial<RunDto> = {}): RunDto {
  return {
    id: 'abcd1234-0000-0000-0000-000000000000',
    project_id: 'p',
    definition_id: 'd',
    name: 'Deploy production',
    status: 'succeeded',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {source: 'manual', event: 'fire'},
    inputs: null,
    duration_ms: 13_000,
    created_at: '2026-05-13T00:00:00.000Z',
    updated_at: '2026-05-13T00:00:13.000Z',
    ...overrides,
  };
}

function renderRow(run: RunDto) {
  return renderWithRouter(
    `/workspaces/${PROJECT_TEST_WID}/projects/${run.project_id}/runs`,
    <RelativeTimeProvider>
      <RunRow run={run} workspaceId={PROJECT_TEST_WID} />
    </RelativeTimeProvider>,
  );
}

describe('RunRow', () => {
  test('renders short id, trigger, workflow name, and terminal duration', async () => {
    renderRow(makeRun({status: 'succeeded', duration_ms: 13_000}));

    expect(await screen.findByText('abcd1234')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByText('13s')).toBeInTheDocument();
  });

  test('shows running duration with current-time computation for running runs', async () => {
    const createdAt = new Date(Date.now() - 30_500).toISOString();

    renderRow(
      makeRun({
        status: 'running',
        duration_ms: 0,
        created_at: createdAt,
        updated_at: '2026-05-13T00:00:10.000Z',
      }),
    );

    expect(await screen.findByText('running 30s')).toBeInTheDocument();
  });

  test('links to the run detail route', async () => {
    renderRow(makeRun());

    expect(await screen.findByRole('link')).toHaveAttribute(
      'href',
      `/workspaces/${PROJECT_TEST_WID}/projects/p/runs/abcd1234-0000-0000-0000-000000000000`,
    );
  });
});

function renderWithRouter(path: string, element: ReactElement) {
  const rootRoute = createRootRoute({component: Outlet});
  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid/runs',
    component: () => element,
  });
  const runDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid/runs/$rid',
    component: () => null,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: [path]}),
    routeTree: rootRoute.addChildren([runsRoute, runDetailRoute]),
  });

  return render(<RouterProvider router={router} />);
}
