// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {type ClientAnalytics, ClientAnalyticsProvider} from '@shipfox/client-shell/runtime';
import {afterEach, describe, expect, test, vi} from '@shipfox/vitest/vi';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {FIRST_WORKFLOW_PROMPT, FirstWorkflowPanel} from './first-workflow-panel.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

const WORKSPACE: WorkspaceReference = {id: 'test-workspace', slug: 'acme'};
const WORKSPACE_SLUG = WORKSPACE.slug;
const CONNECTED_RE = /^Connected:/u;
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

function renderPanel(analytics: ClientAnalytics, grants: ReturnType<typeof grant>[] = []) {
  const rootRoute = createRootRoute({component: Outlet});
  const panelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug',
    component: () => <FirstWorkflowPanel workspace={WORKSPACE} />,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/settings/agent-access',
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([panelRoute, settingsRoute]),
    history: createMemoryHistory({initialEntries: [`/w/${WORKSPACE_SLUG}`]}),
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(agentGrantsQueryOptions().queryKey, grants);

  return render(
    <ClientAnalyticsProvider analytics={analytics}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ClientAnalyticsProvider>,
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'clipboard');
  vi.restoreAllMocks();
});

describe('FirstWorkflowPanel', () => {
  test('renders the MCP setup step and the manual quickstart', async () => {
    const capture = vi.fn();
    renderPanel({capture});

    expect(await screen.findByRole('heading', {name: 'Create your first workflow'})).toBeVisible();
    expect(screen.getByRole('heading', {name: '1. Connect the Shipfox MCP server'})).toBeVisible();
    expect(screen.getByRole('heading', {name: '2. Copy the setup prompt'})).toBeVisible();
    expect(screen.getByText(FIRST_WORKFLOW_PROMPT)).toBeVisible();
    expect(screen.getByRole('link', {name: 'Connect MCP server'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE_SLUG}/settings/agent-access`,
    );
    expect(screen.getByRole('link', {name: 'Use the manual quickstart'})).toHaveAttribute(
      'href',
      'https://www.shipfox.io/docs/getting-started',
    );
    await waitFor(() =>
      expect(capture).toHaveBeenCalledWith('first_workflow_panel_opened', undefined),
    );
  });

  test('marks the MCP step as connected when this workspace has a grant', async () => {
    renderPanel({capture: vi.fn()}, [
      grant('other-workspace', 'Codex'),
      grant(WORKSPACE.id, 'Claude Code'),
    ]);

    expect(await screen.findByText('Connected: Claude Code')).toBeVisible();
    expect(screen.queryByRole('link', {name: 'Connect MCP server'})).not.toBeInTheDocument();
  });

  test('keeps the connect link when only another workspace has a grant', async () => {
    renderPanel({capture: vi.fn()}, [grant('other-workspace', 'Codex')]);

    expect(await screen.findByRole('link', {name: 'Connect MCP server'})).toBeVisible();
    expect(screen.queryByText(CONNECTED_RE)).not.toBeInTheDocument();
  });

  test('copies the fixed prompt and reports the copy event', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {writeText},
    });
    const capture = vi.fn();
    renderPanel({capture});

    fireEvent.click(await screen.findByRole('button', {name: 'Copy prompt'}));

    expect(writeText).toHaveBeenCalledWith(FIRST_WORKFLOW_PROMPT);
    await waitFor(() => expect(screen.getByRole('button', {name: 'Copied'})).toBeVisible());
    expect(capture).toHaveBeenCalledWith('first_workflow_prompt_copied', undefined);
  });
});
