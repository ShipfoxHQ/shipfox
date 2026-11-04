import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {ActiveRun} from '#core/conversation.js';
import {ChatActiveRuns} from './chat-runs.js';

function activeRun(number: number): ActiveRun {
  return {
    runId: `00000000-0000-4000-a000-${String(number).padStart(12, '0')}`,
    number,
    name: 'implement',
    attempt: 1,
    status: 'running',
    startedAt: '2026-11-02T10:00:00.000Z',
    jobsFinished: 2,
    jobsTotal: 5,
  };
}

async function renderActiveRuns(runs: readonly ActiveRun[]) {
  const rootRoute = createRootRoute({component: Outlet});
  const pageRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <ChatActiveRuns runs={runs} workspaceSlug="acme" projectSlug="api" />,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute.addChildren([pageRoute]),
  });
  await router.load();
  await act(() => {
    render(<RouterProvider router={router} />);
  });
}

describe('ChatActiveRuns', () => {
  test('links three runs and collapses the rest into a count', async () => {
    await renderActiveRuns([1, 2, 3, 4, 5].map(activeRun));

    const region = screen.getByRole('region', {name: 'Active runs'});
    const links = within(region).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'implement #1',
      'implement #2',
      'implement #3',
    ]);
    expect(links[0]).toHaveAttribute('href', `/w/acme/p/api/runs/${activeRun(1).runId}`);
  });

  test('lists the runs past the first three from the count', async () => {
    const user = userEvent.setup();
    await renderActiveRuns([1, 2, 3, 4, 5].map(activeRun));

    await user.click(screen.getByRole('button', {name: 'Show 2 more runs'}));

    const more = await screen.findByRole('list', {name: 'More active runs'});
    const links = within(more).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', `/w/acme/p/api/runs/${activeRun(4).runId}`);
    expect(within(links[0] as HTMLElement).getByText('2 of 5 jobs finished')).toBeInTheDocument();
  });

  test('shows what a run is doing when its chip is focused', async () => {
    const user = userEvent.setup();
    await renderActiveRuns([{...activeRun(1), attempt: 2}]);

    await user.tab();

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Running · Attempt 2');
  });

  test('shows nothing while no run is active', async () => {
    await renderActiveRuns([]);

    expect(screen.queryByRole('region', {name: 'Active runs'})).not.toBeInTheDocument();
  });
});
