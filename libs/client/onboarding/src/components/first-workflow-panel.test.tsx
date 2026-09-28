// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {configureApiClient} from '@shipfox/client-api';
import {type ClientAnalytics, ClientAnalyticsProvider} from '@shipfox/client-shell/runtime';
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
import {cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import type {WorkflowTemplate} from '#core/workflow-templates.js';
import {workflowTemplateQueryKeys} from '#hooks/api/workflow-templates.js';
import {
  allToolsWorkflowTemplates,
  githubOnlyWorkflowTemplates,
} from '#test/fixtures/workflow-templates.js';
import {
  FIRST_WORKFLOW_PROMPT,
  FirstWorkflowPanel,
  type FirstWorkflowPanelProgress,
} from './first-workflow-panel.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

const WORKSPACE: WorkspaceReference = {id: 'test-workspace', slug: 'acme'};
const CONNECTED_RE = /^Connected:/u;
const TEMPLATES_FAILED_RE = /Suggested workflows could not load/u;
const TASK_PULL_REQUEST_RE = /Merging the task pull request does not turn/u;
const now = new Date().toISOString();

function grant(workspaceId: string, clientName: string) {
  return {
    id: `${workspaceId}-${clientName}`,
    clientName,
    workspaceId,
    createdAt: now,
    lastRefreshedAt: null,
  };
}

type GrantFixture = ReturnType<typeof grant>[] | 'pending';

function renderPanel({
  analytics = {capture: vi.fn()},
  grants = [],
  templates = githubOnlyWorkflowTemplates,
  progress = {state: 'open'},
}: {
  analytics?: ClientAnalytics;
  grants?: GrantFixture;
  templates?: WorkflowTemplate[] | 'failed';
  progress?: FirstWorkflowPanelProgress;
} = {}) {
  const rootRoute = createRootRoute({component: Outlet});
  const panelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: () => (
      <FirstWorkflowPanel workspace={WORKSPACE} progress={progress} surface="home" />
    ),
  });
  const stubRoutes = ['/runs/$workflowRunId'].map((path) =>
    createRoute({getParentRoute: () => rootRoute, path, component: () => null}),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([panelRoute, ...stubRoutes]),
    history: createMemoryHistory({initialEntries: [`/w/${WORKSPACE.slug}`]}),
  });
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  if (grants === 'pending') {
    queryClient.setQueryDefaults(agentGrantsQueryOptions().queryKey, {
      queryFn: () => new Promise<ReturnType<typeof grant>[]>(() => undefined),
    });
  } else {
    queryClient.setQueryData(agentGrantsQueryOptions().queryKey, grants);
  }
  if (templates === 'failed') {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.reject(new Error('request failed'))),
    });
  } else {
    queryClient.setQueryData(workflowTemplateQueryKeys.workspace(WORKSPACE.id), templates);
  }

  return render(
    <ClientAnalyticsProvider analytics={analytics}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ClientAnalyticsProvider>,
  );
}

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
  return writeText;
}

beforeEach(() => {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

describe('FirstWorkflowPanel in choose mode', () => {
  test('shows the MCP setup inline and reports the opened mode', async () => {
    const capture = vi.fn();
    renderPanel({analytics: {capture}});

    expect(await screen.findByRole('heading', {name: 'Create your first workflow'})).toBeVisible();
    expect(screen.getByRole('heading', {name: '1. Connect your coding agent'})).toBeVisible();
    expect(screen.getByRole('tab', {name: 'Claude Code'})).toBeVisible();
    expect(screen.getByRole('heading', {name: '2. Pick a workflow'})).toBeVisible();
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('first_workflow_panel_opened', {
        surface: 'home',
        mode: 'choose',
      }),
    );
  });

  test('collapses the MCP step once this workspace has a grant', async () => {
    renderPanel({grants: [grant('other-workspace', 'Codex'), grant(WORKSPACE.id, 'Claude Code')]});

    expect(await screen.findByText('Connected: Claude Code')).toBeVisible();
    expect(screen.queryByRole('tab', {name: 'Claude Code'})).not.toBeInTheDocument();
  });

  test('offers neither branch of the MCP step until the grant query resolves', async () => {
    renderPanel({grants: 'pending'});

    expect(
      await screen.findByRole('heading', {name: '1. Connect your coding agent'}),
    ).toBeVisible();
    expect(screen.queryByRole('tab', {name: 'Claude Code'})).not.toBeInTheDocument();
    expect(screen.queryByText(CONNECTED_RE)).not.toBeInTheDocument();
  });

  test('keeps the MCP setup when only another workspace has a grant', async () => {
    renderPanel({grants: [grant('other-workspace', 'Codex')]});

    expect(await screen.findByRole('tab', {name: 'Claude Code'})).toBeVisible();
    expect(screen.queryByText(CONNECTED_RE)).not.toBeInTheDocument();
  });

  test('recommends one workflow and lists the others a GitHub-only workspace can run', async () => {
    renderPanel();

    expect(await screen.findByRole('heading', {name: 'Task to pull request'})).toBeVisible();
    expect(screen.getByText('Recommended · Try it now')).toBeVisible();
    const others = within(screen.getByRole('list', {name: 'More suggested workflows'}));
    expect(others.getAllByRole('heading').map((heading) => heading.textContent)).toEqual([
      'Investigate and repair default-branch CI failures',
      'Repair failing pull request CI',
    ]);
    expect(others.getByText('Starts on a failing dependency update')).toBeVisible();
    expect(screen.queryByText('Ask the codebase in Slack')).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Browse all examples'})).toHaveAttribute(
      'href',
      'https://www.shipfox.io/docs/examples',
    );
  });

  test('caps the other suggestions at three when many templates are usable', async () => {
    renderPanel({templates: allToolsWorkflowTemplates});

    const others = within(await screen.findByRole('list', {name: 'More suggested workflows'}));
    expect(others.getAllByRole('listitem')).toHaveLength(3);
  });

  test('copies a template prompt and captures the template ID', async () => {
    const writeText = stubClipboard();
    const capture = vi.fn();
    renderPanel({analytics: {capture}});

    fireEvent.click(
      await screen.findByRole('button', {name: 'Copy prompt for Task to pull request'}),
    );

    expect(writeText).toHaveBeenCalledWith(
      'Use Shipfox to create a workflow from the ticket-to-pr template.',
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', {name: 'Copied prompt for Task to pull request'}),
      ).toBeVisible(),
    );
    expect(capture).toHaveBeenCalledWith('first_workflow_prompt_copied', {
      surface: 'home',
      template_id: 'ticket-to-pr',
      group: 'try_now',
    });
  });

  test('copies a listed workflow from its row', async () => {
    const writeText = stubClipboard();
    const capture = vi.fn();
    renderPanel({analytics: {capture}});

    fireEvent.click(
      await screen.findByRole('button', {name: 'Copy prompt for Repair failing pull request CI'}),
    );

    expect(writeText).toHaveBeenCalledWith(
      'Use Shipfox to create a workflow from the fix-dependency-ci template.',
    );
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('first_workflow_prompt_copied', {
        surface: 'home',
        template_id: 'fix-dependency-ci',
        group: 'starts_on_event',
      }),
    );
  });

  test('copies the generic prompt for something else', async () => {
    const writeText = stubClipboard();
    const capture = vi.fn();
    renderPanel({analytics: {capture}});

    fireEvent.click(await screen.findByRole('button', {name: 'Copy a generic prompt'}));

    expect(writeText).toHaveBeenCalledWith(FIRST_WORKFLOW_PROMPT);
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('first_workflow_prompt_copied', {
        surface: 'home',
        template_id: 'generic',
      }),
    );
  });

  test('keeps the generic prompt and the examples when templates fail to load', async () => {
    renderPanel({templates: 'failed'});

    expect(await screen.findByText(TEMPLATES_FAILED_RE)).toBeVisible();
    expect(screen.queryByRole('heading', {name: 'Task to pull request'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Copy a generic prompt'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Browse all examples'})).toBeVisible();
  });
});

describe('FirstWorkflowPanel in finish mode', () => {
  test('links the test run and explains which pull request turns the workflow on', async () => {
    const capture = vi.fn();
    renderPanel({
      analytics: {capture},
      progress: {state: 'test_run_succeeded', testRunId: 'run-1'},
    });

    expect(await screen.findByRole('heading', {name: 'Finish your first workflow'})).toBeVisible();
    expect(screen.getByText('A test run succeeded.')).toBeVisible();
    expect(screen.getByRole('link', {name: 'View run'})).toHaveAttribute('href', '/runs/run-1');
    expect(screen.getByText(TASK_PULL_REQUEST_RE)).toBeVisible();
    expect(screen.queryByRole('tab', {name: 'Claude Code'})).not.toBeInTheDocument();
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('first_workflow_panel_opened', {
        surface: 'home',
        mode: 'finish',
      }),
    );
  });

  test('keeps the templates behind a disclosure', async () => {
    renderPanel({progress: {state: 'test_run_succeeded', testRunId: 'run-1'}});

    const disclosure = await screen.findByRole('button', {name: 'Set up a different workflow'});
    expect(screen.queryByRole('heading', {name: 'Task to pull request'})).not.toBeInTheDocument();

    fireEvent.click(disclosure);

    expect(await screen.findByRole('heading', {name: 'Task to pull request'})).toBeVisible();
  });
});
