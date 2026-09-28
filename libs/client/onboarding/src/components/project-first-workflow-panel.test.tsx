// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {configureApiClient} from '@shipfox/client-api';
import {ClientAnalyticsProvider} from '@shipfox/client-shell/runtime';
import {afterEach, beforeEach, describe, expect, test} from '@shipfox/vitest/vi';
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
import {workflowTemplateQueryKeys} from '#hooks/api/workflow-templates.js';
import {githubOnlyWorkflowTemplates} from '#test/fixtures/workflow-templates.js';
import {ProjectFirstWorkflowPanel} from './project-first-workflow-panel.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

const api = vi.hoisted(() => ({
  listDefinitions: vi.fn(),
  listWorkflowRuns: vi.fn(),
}));

vi.mock('@shipfox/client-projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/client-projects')>()),
  listDefinitions: api.listDefinitions,
}));
vi.mock('@shipfox/client-workflows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shipfox/client-workflows')>()),
  listWorkflowRuns: api.listWorkflowRuns,
}));

const WORKSPACE: WorkspaceReference = {id: 'test-workspace', slug: 'acme'};
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

interface ProjectSeed {
  definitions?: number;
  devRunId?: string;
}

function seedProjects(projects: Record<string, ProjectSeed>) {
  api.listDefinitions.mockImplementation(({projectId}: {projectId: string}) =>
    Promise.resolve({
      definitions: Array.from({length: projects[projectId]?.definitions ?? 0}, (_, index) => ({
        id: `${projectId}-definition-${index}`,
      })),
      sync: null,
      nextCursor: null,
    }),
  );
  api.listWorkflowRuns.mockImplementation(({projectId}: {projectId: string}) => {
    const runId = projects[projectId]?.devRunId;
    return Promise.resolve({
      runs: runId ? [{id: runId, createdAt: '2026-09-01T10:00:00.000Z'}] : [],
      nextCursor: null,
      filteredTotalCount: null,
    });
  });
}

function renderProjectPanel(projectId: string) {
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
  vi.resetAllMocks();
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
});

afterEach(() => {
  cleanup();
});

describe('ProjectFirstWorkflowPanel', () => {
  test("keeps project A's definition and test run out of project B's panel", async () => {
    seedProjects({[PROJECT_A]: {definitions: 1, devRunId: 'run-a'}, [PROJECT_B]: {}});

    const {capture} = renderProjectPanel(PROJECT_B);

    expect(await screen.findByRole('heading', {name: 'Create your first workflow'})).toBeVisible();
    expect(screen.queryByRole('link', {name: 'View run'})).not.toBeInTheDocument();
    expect(api.listDefinitions).not.toHaveBeenCalledWith(
      expect.objectContaining({projectId: PROJECT_A}),
    );
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('first_workflow_panel_opened', {
        surface: 'workflows_empty',
        mode: 'choose',
      }),
    );
  });

  test("links the project's own succeeded test run in finish mode", async () => {
    seedProjects({[PROJECT_B]: {devRunId: 'run-b'}});

    renderProjectPanel(PROJECT_B);

    expect(await screen.findByRole('heading', {name: 'Finish your first workflow'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'View run'})).toHaveAttribute('href', '/runs/run-b');
  });
});
