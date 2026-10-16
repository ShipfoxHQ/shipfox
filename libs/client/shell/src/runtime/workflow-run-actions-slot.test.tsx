import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen} from '@testing-library/react';
import {ChromeProvider, type ChromeSlots, type WorkflowRunActionsProps} from './chrome-context.js';
import {WorkflowRunActionsSlot} from './workflow-run-actions-slot.js';

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';

function RunActions() {
  return (
    <>
      <WorkflowRunActionsSlot workflowRunId={RUN_ID} projectId={PROJECT_ID} />
      <button type="button">Re-run workflow</button>
    </>
  );
}

async function renderSlot(slot?: ChromeSlots['WorkflowRunActions']) {
  const chrome: ChromeSlots = {
    ProjectBreadcrumb: () => null,
    projectSlugResolver: async () => 'project',
    ...(slot ? {WorkflowRunActions: slot} : {}),
  };
  const rootRoute = createRootRoute({component: Outlet});
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$workflowRunId',
    component: RunActions,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: [`/runs/${RUN_ID}`]}),
    routeTree: rootRoute.addChildren([runRoute]),
  });
  render(
    <ChromeProvider chrome={chrome}>
      <RouterProvider router={router} />
    </ChromeProvider>,
  );
  await screen.findByRole('button', {name: 'Re-run workflow'});
  return router;
}

describe('WorkflowRunActionsSlot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('renders the slot with the run and project ids', async () => {
    function Slot({workflowRunId, projectId}: WorkflowRunActionsProps) {
      return (
        <button type="button">
          {workflowRunId} {projectId}
        </button>
      );
    }

    await renderSlot(Slot);

    expect(screen.getByRole('button', {name: `${RUN_ID} ${PROJECT_ID}`})).toBeVisible();
  });

  test('renders nothing when the chrome omits the slot', async () => {
    await renderSlot();

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  test('renders nothing without a chrome provider', () => {
    const {container} = render(
      <WorkflowRunActionsSlot workflowRunId={RUN_ID} projectId={PROJECT_ID} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing and reports the error when the slot throws', async () => {
    const failure = new Error('Slot failed');
    const reportErrorSpy = vi.fn();
    vi.stubGlobal('reportError', reportErrorSpy);
    function Slot(): never {
      throw failure;
    }

    await renderSlot(Slot);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(reportErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: failure,
        message: 'Failed to render workflow run actions.',
      }),
    );
  });

  test('retries a failed slot after navigation', async () => {
    vi.stubGlobal('reportError', vi.fn());
    let fail = true;
    function Slot() {
      if (fail) throw new Error('Slot failed');
      return <button type="button">Improve</button>;
    }

    const router = await renderSlot(Slot);
    expect(screen.queryByRole('button', {name: 'Improve'})).not.toBeInTheDocument();

    fail = false;
    await act(() => router.history.push(`/runs/${RUN_ID}?tab=jobs`));

    expect(await screen.findByRole('button', {name: 'Improve'})).toBeVisible();
  });
});
