import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen} from '@testing-library/react';
import {
  PreDispatchStepDiagnostic,
  preDispatchStepDiagnostic,
} from './pre-dispatch-step-diagnostic.js';

describe('preDispatchStepDiagnostic', () => {
  it('classifies only failed attempts with an unresolvable configuration', () => {
    expect(
      preDispatchStepDiagnostic('failed', {
        reason: 'config_unresolvable',
        field: 'agent.session',
        source: 'steps.confirm_current_head.outputs.current_head_sha',
      }),
    ).toEqual({
      field: 'agent.session',
      source: 'steps.confirm_current_head.outputs.current_head_sha',
    });
    expect(preDispatchStepDiagnostic('succeeded', {reason: 'config_unresolvable'})).toBeUndefined();
    expect(
      preDispatchStepDiagnostic('failed', {reason: 'agent_invocation_failed'}),
    ).toBeUndefined();
  });

  it('omits unavailable optional details', () => {
    expect(
      preDispatchStepDiagnostic('failed', {
        reason: 'config_unresolvable',
        field: '',
        source: null,
      }),
    ).toEqual({});
  });
});

describe('PreDispatchStepDiagnostic', () => {
  it('explains why the step has no logs and keeps its source action', async () => {
    await renderDiagnostic({
      diagnostic: {
        field: 'agent.session',
        source: 'steps.confirm_current_head.outputs.current_head_sha',
      },
      sourceLocation: {startLine: 20, endLine: 29},
    });

    expect(screen.getByRole('heading', {name: 'Step did not run'})).toBeInTheDocument();
    expect(
      screen.getByText('Shipfox could not resolve this step’s configuration before dispatch.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Configuration field')).toBeInTheDocument();
    expect(screen.getByText('agent.session')).toBeInTheDocument();
    expect(screen.getByText('Unavailable reference')).toBeInTheDocument();
    expect(
      screen.getByText('steps.confirm_current_head.outputs.current_head_sha'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'View in source'})).toHaveAttribute(
      'href',
      expect.stringContaining('tab=source'),
    );
  });

  it('keeps the explanation when field and source are absent', async () => {
    await renderDiagnostic({diagnostic: {}, sourceLocation: null});

    expect(screen.getByRole('heading', {name: 'Step did not run'})).toBeInTheDocument();
    expect(screen.queryByText('Configuration field')).toBeNull();
    expect(screen.queryByText('Unavailable reference')).toBeNull();
    expect(screen.queryByRole('link', {name: 'View in source'})).toBeNull();
  });
});

async function renderDiagnostic({
  diagnostic,
  sourceLocation,
}: Pick<Parameters<typeof PreDispatchStepDiagnostic>[0], 'diagnostic' | 'sourceLocation'>) {
  const rootRoute = createRootRoute({component: Outlet});
  const diagnosticRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => (
      <PreDispatchStepDiagnostic
        diagnostic={diagnostic}
        stepLabel="Resolve agent session"
        stepId="55555555-5555-4555-8555-555555555555"
        attemptId="66666666-6666-4666-8666-666666666666"
        attemptOrdinal={1}
        sourceLocation={sourceLocation}
        workspaceSlug="acme"
        projectSlug="platform"
        workflowRunId="11111111-1111-4111-8111-111111111111"
        runAttempt={1}
      />
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: ['/w/acme/p/platform/runs/11111111-1111-4111-8111-111111111111'],
    }),
    routeTree: rootRoute.addChildren([diagnosticRoute]),
  });
  await router.load();
  await act(() => render(<RouterProvider router={router} />));
}
