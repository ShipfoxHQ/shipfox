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
import {RelativeTimeProvider} from '#lib/relative-time.js';
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
    duration_ms: 0,
    created_at: '2026-05-13T00:00:00.000Z',
    updated_at: '2026-05-13T00:00:13.000Z',
    ...overrides,
  };
}

function renderRow(run: RunDto) {
  return render(
    <RelativeTimeProvider>
      <RunRow run={run} />
    </RelativeTimeProvider>,
  );
}

describe('RunRow', () => {
  test('renders short id, trigger, workflow name, and DTO duration', () => {
    renderRow(makeRun({status: 'succeeded', duration_ms: 13_000}));

    expect(screen.getByText('abcd1234')).toBeInTheDocument();
    expect(screen.getByText('manual')).toBeInTheDocument();
    expect(screen.getByText('Deploy production')).toBeInTheDocument();
    expect(screen.getByText('13s')).toBeInTheDocument();
  });

  test('prefixes DTO duration for running runs', () => {
    renderRow(makeRun({status: 'running', duration_ms: 30_000}));

    expect(screen.getByText('running 30s')).toBeInTheDocument();
  });

  test('is not interactive — no role=button, no tabindex on the row', () => {
    const {container} = renderRow(makeRun());

    const row = container.firstChild as HTMLElement;
    expect(row.getAttribute('role')).not.toBe('button');
    expect(row.getAttribute('tabindex')).toBe(null);
  });

  test('links to the run detail route when params are provided', async () => {
    const run = makeRun();
    renderLinkedRow(run);

    await screen.findByText('abcd1234');

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      `/workspaces/workspace-1/projects/project-1/runs/${run.id}`,
    );
  });
});

function renderLinkedRow(run: RunDto) {
  const rootRoute = createRootRoute({component: Outlet});
  const runsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid',
    component: () => (
      <RelativeTimeProvider>
        <RunRow run={run} linkParams={{workspaceId: 'workspace-1', projectId: 'project-1'}} />
      </RelativeTimeProvider>
    ),
  });
  const runDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid/projects/$pid/runs/$rid',
    component: () => <div>Run detail</div>,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/workspaces/workspace-1/projects/project-1']}),
    routeTree: rootRoute.addChildren([runsRoute, runDetailRoute]),
  });

  return render(<RouterProvider router={router} />);
}
