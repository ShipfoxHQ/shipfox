// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {configureApiClient} from '@shipfox/client-api';
import {ClientAnalyticsProvider} from '@shipfox/client-shell/runtime';
import {afterEach, beforeEach, describe, expect, test, vi} from '@shipfox/vitest/vi';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {cleanup, render, screen, waitFor} from '@testing-library/react';
import type {FirstWorkflowProgress} from '#core/setup-checklist.js';
import {type FirstWorkflowScope, firstWorkflowQueryKeys} from '#hooks/api/first-workflow.js';
import {workflowTemplateQueryKeys} from '#hooks/api/workflow-templates.js';
import {githubOnlyWorkflowTemplates} from '#test/fixtures/workflow-templates.js';
import {ProjectFirstWorkflowPanel} from './project-first-workflow-panel.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

const WORKSPACE: WorkspaceReference = {id: 'test-workspace', slug: 'acme'};
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

type ProgressByScope = [FirstWorkflowScope, FirstWorkflowProgress][];

function renderProjectPanel(projectId: string, progress: ProgressByScope) {
  const capture = vi.fn();
  const rootRoute = createRootRoute({component: Outlet});
  const panelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: () => <ProjectFirstWorkflowPanel projectId={projectId} workspace={WORKSPACE} />,
  });
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/runs/$workflowRunId',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([panelRoute, runRoute]),
    history: createMemoryHistory({initialEntries: [`/w/${WORKSPACE.slug}`]}),
  });
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  queryClient.setQueryData(agentGrantsQueryOptions().queryKey, []);
  queryClient.setQueryData(
    workflowTemplateQueryKeys.workspace(WORKSPACE.id),
    githubOnlyWorkflowTemplates,
  );
  for (const [scope, value] of progress) {
    queryClient.setQueryData(firstWorkflowQueryKeys.scope(scope), value);
  }

  render(
    <ClientAnalyticsProvider analytics={{capture}}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ClientAnalyticsProvider>,
  );
  return {capture};
}

beforeEach(() => {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
  });
});

afterEach(() => {
  cleanup();
});

describe('ProjectFirstWorkflowPanel', () => {
  test("keeps project A's definition and test run out of project B's panel", async () => {
    const {capture} = renderProjectPanel(PROJECT_B, [
      [{kind: 'workspace', workspaceId: WORKSPACE.id}, {state: 'done'}],
      [
        {kind: 'project', projectId: PROJECT_A},
        {state: 'test_run_succeeded', testRunId: 'run-a'},
      ],
      [{kind: 'project', projectId: PROJECT_B}, {state: 'open'}],
    ]);

    expect(await screen.findByRole('heading', {name: 'Create your first workflow'})).toBeVisible();
    expect(screen.queryByRole('link', {name: 'View run'})).not.toBeInTheDocument();
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('first_workflow_panel_opened', {
        surface: 'workflows_empty',
        mode: 'choose',
      }),
    );
  });

  test("links the project's own succeeded test run in finish mode", async () => {
    renderProjectPanel(PROJECT_B, [
      [
        {kind: 'project', projectId: PROJECT_B},
        {state: 'test_run_succeeded', testRunId: 'run-b'},
      ],
    ]);

    expect(await screen.findByRole('heading', {name: 'Finish your first workflow'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'View run'})).toHaveAttribute('href', '/runs/run-b');
  });
});
