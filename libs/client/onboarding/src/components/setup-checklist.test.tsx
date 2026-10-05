// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {modelProviderQueryKeys} from '@shipfox/client-agent';
import {configureApiClient} from '@shipfox/client-api';
import {
  type IntegrationConnection,
  type IntegrationProvider,
  integrationConnectionsQueryOptions,
  integrationProvidersQueryOptions,
} from '@shipfox/client-integrations';
import {provisionerTokenQueryKeys} from '@shipfox/client-runners';
import {
  type ClientAnalytics,
  ClientAnalyticsProvider,
  clearWorkspaceSetupChecklistDismissal,
  dismissWorkspaceSetupChecklist,
} from '@shipfox/client-shell/runtime';
import {listInvitationsQueryKey, listMembersQueryKey} from '@shipfox/client-workspace-settings';
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
import {act, cleanup, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {Suspense} from 'react';
import {deriveIntegrationReadiness} from '#core/integration-readiness.js';
import {deriveSetupChecklist, type FirstWorkflowProgress} from '#core/setup-checklist.js';
import {WorkspaceSetupIndicator as WorkspaceSetupIndicatorSlot} from '#feature.js';
import {firstWorkflowQueryKeys} from '#hooks/api/first-workflow.js';
import {
  SetupChecklistBody,
  type WorkspaceReference,
  WorkspaceSetupChecklist,
  WorkspaceSetupIndicator,
} from './setup-checklist.js';

const WORKSPACE: WorkspaceReference = {id: 'test-workspace', slug: 'acme'};
const OTHER_WORKSPACE: WorkspaceReference = {id: 'other-test-workspace', slug: 'acme'};
const GET_STARTED_BUTTON_RE = /Get started/u;
const SHOW_ALL_STEPS_RE = /Show all/u;
const now = new Date().toISOString();
const githubProvider: IntegrationProvider = {
  provider: 'github',
  displayName: 'GitHub',
  capabilities: ['source_control'],
};
const linearProvider: IntegrationProvider = {
  provider: 'linear',
  displayName: 'Linear',
  capabilities: ['agent_tools'],
};

function connection(
  provider: 'github' | 'linear',
  lifecycleStatus: IntegrationConnection['lifecycleStatus'],
): IntegrationConnection {
  return {
    id: `${provider}-connection`,
    workspaceId: WORKSPACE.id,
    provider,
    externalAccountId: `${provider}-account`,
    slug: `${provider}-account`,
    displayName: provider === 'github' ? 'GitHub' : 'Linear',
    lifecycleStatus,
    capabilities: provider === 'github' ? ['source_control'] : ['agent_tools'],
    createdAt: now,
    updatedAt: now,
  };
}

function createQueryClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false}}});
}

function pendingResponse(): Promise<Response> {
  return new Promise<Response>((resolve) => {
    void resolve;
  });
}

function firstWorkflowKey(workspace: WorkspaceReference = WORKSPACE) {
  return firstWorkflowQueryKeys.scope({kind: 'workspace', workspaceId: workspace.id});
}

function seedFirstWorkflow(
  queryClient: QueryClient,
  progress: FirstWorkflowProgress,
  workspace: WorkspaceReference = WORKSPACE,
) {
  queryClient.setQueryData(firstWorkflowKey(workspace), progress);
}

/** The first workflow defaults to done so the tools row stays the one that moves. */
function seedQueries(
  queryClient: QueryClient,
  toolsConnected = false,
  workspace: WorkspaceReference = WORKSPACE,
  firstWorkflow: FirstWorkflowProgress = {state: 'done'},
) {
  seedFirstWorkflow(queryClient, firstWorkflow, workspace);
  queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
    githubProvider,
    linearProvider,
  ]);
  queryClient.setQueryData(integrationConnectionsQueryOptions(workspace.id).queryKey, [
    connection('github', 'active'),
    ...(toolsConnected ? [connection('linear', 'active')] : []),
  ]);
  queryClient.setQueryData(provisionerTokenQueryKeys.active(workspace.id), {
    provisioners: [],
    installationRunners: 'managed' as const,
  });
  queryClient.setQueryData(modelProviderQueryKeys.catalog(), {
    providers: [],
    workspaceProviders: 'enabled' as const,
    managedProviderId: 'managed-default',
    instanceDefaultProviderId: null,
  });
  queryClient.setQueryData(modelProviderQueryKeys.configs(workspace.id), {
    configs: [],
    defaultHarnessId: null,
    defaultProviderId: null,
  });
  queryClient.setQueryData(listMembersQueryKey(workspace.id), [
    {
      id: 'member-1',
      userId: 'user-1',
      workspaceId: workspace.id,
      email: 'you@example.com',
      name: 'You',
      role: 'admin' as const,
      joinedAt: now,
      updatedAt: now,
    },
  ]);
  queryClient.setQueryData(listInvitationsQueryKey(workspace.id), []);
}

function renderWithProviders(
  element: React.ReactElement,
  queryClient: QueryClient,
  analytics: ClientAnalytics,
) {
  const rootRoute = createRootRoute({component: Outlet});
  const routePaths = [
    '/w/$workspaceSlug',
    '/w/$workspaceSlug/settings/integrations',
    '/w/$workspaceSlug/settings/runners',
    '/w/$workspaceSlug/settings/agents',
    '/w/$workspaceSlug/settings/members',
    '/w/$workspaceSlug/setup/members',
    '/runs/$workflowRunId',
  ];
  const routes = routePaths.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => element,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({initialEntries: ['/w/acme']}),
  });

  return render(
    <ClientAnalyticsProvider analytics={analytics}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ClientAnalyticsProvider>,
  );
}

describe('SetupChecklistBody', () => {
  test('renders ordered statuses, purposes, and actions', async () => {
    const checklist = deriveSetupChecklist({
      readiness: deriveIntegrationReadiness({
        providers: [githubProvider, linearProvider],
        connections: [connection('github', 'active')],
      }),
      installationRunners: 'none',
      workspaceRunnerCapacity: false,
      modelProvider: {installationProvided: false, configured: false},
      membership: {memberCount: 1, pendingInvitationCount: 0},
      firstWorkflow: {state: 'open'},
    });
    const queryClient = createQueryClient();

    renderWithProviders(
      <SetupChecklistBody checklist={checklist} workspaceSlug={WORKSPACE.slug} />,
      queryClient,
      {capture: vi.fn()},
    );

    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    expect(
      await screen.findByText('Jobs wait in `pending` until a runner is online'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('link', {name: 'Connect'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/integrations`,
    );
    expect(await screen.findByRole('link', {name: 'Set up'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/runners`,
    );
    expect(await screen.findByRole('link', {name: 'Configure'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/agents`,
    );
    expect(await screen.findByRole('link', {name: 'Choose a workflow'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}`,
    );
    expect(await screen.findByRole('link', {name: 'Invite'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/setup/members`,
    );
    expect(screen.queryByText('Next', {exact: true})).not.toBeInTheDocument();
    expect(await screen.findAllByText('next step', {exact: true})).toHaveLength(1);
    expect(
      screen
        .getAllByText('done', {exact: true})
        .every((node) => node.classList.contains('sr-only')),
    ).toBe(true);
    expect(
      screen
        .getAllByText('to do', {exact: true})
        .every((node) => node.classList.contains('sr-only')),
    ).toBe(true);
  });
});

describe('workspace checklist hosts', () => {
  beforeEach(() => {
    window.localStorage.clear();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  test('does not subscribe to checklist queries after dismissal', () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    dismissWorkspaceSetupChecklist(WORKSPACE.id);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    for (const queryKey of [integrationProvidersQueryOptions().queryKey, firstWorkflowKey()]) {
      expect(queryClient.getQueryCache().find({queryKey})?.getObserversCount() ?? 0).toBe(0);
    }
    clearWorkspaceSetupChecklistDismissal(WORKSPACE.id);
  });

  test('renders the completion state only after an observed false-to-true transition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(screen.queryByText("You're set up")).not.toBeInTheDocument();
    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });

    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_shown', {host: 'panel'});
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_completed', {host: 'panel'});

    fireEvent.click(screen.getByRole('button', {name: 'Done'}));
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_dismissed', {host: 'panel'});
  });

  test('does not replay or keep the completion state after a regression', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });
    expect(await screen.findByText("You're set up")).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
      ]);
    });
    await waitFor(() => expect(screen.queryByText("You're set up")).not.toBeInTheDocument());

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });
    await waitFor(() => expect(screen.queryByText("You're set up")).not.toBeInTheDocument());
    expect(
      capture.mock.calls.filter(([event]) => event === 'onboarding_checklist_completed'),
    ).toHaveLength(1);
  });

  test('captures row clicks with the checklist row id', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    fireEvent.click(await screen.findByRole('link', {name: 'Connect'}));

    expect(capture).toHaveBeenCalledWith('onboarding_checklist_row_clicked', {row_id: 'tools'});
  });

  test('exposes the indicator progress without duplicating its completion label', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(
      await screen.findByRole('button', {name: 'Get started, 3 of 4 done'}),
    ).toBeInTheDocument();
  });

  test('shows the indicator completion transition and its dismiss action', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {capture});
    expect(
      await screen.findByRole('button', {name: 'Get started, 3 of 4 done'}),
    ).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });

    const trigger = await screen.findByRole('button', {name: 'Get started, 4 of 4 done'});
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_completed', {host: 'popover'});
    fireEvent.click(trigger);

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent("You're set up");
    expect(status).toHaveAttribute('aria-live', 'polite');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby', trigger.id);
    fireEvent.click(screen.getByRole('button', {name: 'Hide setup guide'}));

    await waitFor(() =>
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument(),
    );
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_dismissed', {host: 'popover'});
  });

  test('synchronizes dismissal between mounted hosts in the same tab', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(
      <>
        <WorkspaceSetupChecklist workspace={WORKSPACE} />
        <WorkspaceSetupIndicator workspace={WORKSPACE} />
      </>,
      queryClient,
      {capture},
    );

    expect(
      await screen.findByRole('button', {name: 'Get started, 3 of 4 done'}),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Hide setup guide'}));

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument();
    });
  });

  test('keeps a local dismissal when browser storage cannot persist it', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(await screen.findByRole('button', {name: 'Hide setup guide'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Hide setup guide'}));

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    });
  });

  test('waits for non-base query families before showing completion', async () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn(() => pendingResponse());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
    ]);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });
    await waitFor(() => expect(screen.queryByText("You're set up")).not.toBeInTheDocument());

    act(() => {
      queryClient.setQueryData(provisionerTokenQueryKeys.active(WORKSPACE.id), {
        provisioners: [],
        installationRunners: 'managed' as const,
      });
      queryClient.setQueryData(modelProviderQueryKeys.catalog(), {
        providers: [],
        workspaceProviders: 'enabled' as const,
        managedProviderId: 'managed-default',
        instanceDefaultProviderId: null,
      });
      queryClient.setQueryData(modelProviderQueryKeys.configs(WORKSPACE.id), {
        configs: [],
        defaultHarnessId: null,
        defaultProviderId: null,
      });
      queryClient.setQueryData(listMembersQueryKey(WORKSPACE.id), []);
      queryClient.setQueryData(listInvitationsQueryKey(WORKSPACE.id), []);
    });
    await waitFor(() => expect(screen.queryByText("You're set up")).not.toBeInTheDocument());

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'done'});
    });

    expect(await screen.findByText("You're set up")).toBeInTheDocument();
  });

  test('renders no panel while base queries are pending', async () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn(() => pendingResponse());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {container} = renderWithProviders(
      <WorkspaceSetupChecklist workspace={WORKSPACE} />,
      queryClient,
      {capture: vi.fn()},
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('hides rows from failed query families without marking the checklist complete', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.reject(new Error('request failed'))),
    });

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    expect(screen.queryByText('Connect your tools')).not.toBeInTheDocument();
    expect(screen.queryByText('Set up runner capacity')).not.toBeInTheDocument();
    expect(screen.queryByText('Configure a model provider')).not.toBeInTheDocument();
    expect(screen.queryByText("You're set up")).not.toBeInTheDocument();
  });

  test('does not let a failed optional family block visible completion', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.reject(new Error('optional request failed'))),
    });
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
      connection('linear', 'active'),
    ]);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    });
  });

  test('hides the indicator while optional checklist families are unsettled', async () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn(() => pendingResponse());
    const capture = vi.fn();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
      connection('linear', 'active'),
    ]);

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {capture});

    await waitFor(() => {
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument();
    });
    expect(capture).not.toHaveBeenCalledWith('onboarding_checklist_shown', {host: 'popover'});
  });

  test('does not report the panel as shown while completion is unresolved', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
      connection('linear', 'active'),
    ]);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    act(() => {
      seedQueries(queryClient, true);
    });

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    });
    expect(capture).not.toHaveBeenCalledWith('onboarding_checklist_shown', {host: 'panel'});
  });

  test('shows only the next step until the reader opens the full list', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    expect(screen.queryByRole('list', {name: 'Setup steps'})).not.toBeInTheDocument();
    expect(screen.queryByText('Create a project')).not.toBeInTheDocument();
    expect(screen.queryByText('Create your first workflow')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', {name: 'Show all 5 steps'});
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('Create your first workflow')).toBeInTheDocument();

    const collapse = screen.getByRole('button', {name: 'Show less'});
    expect(collapse).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapse);

    await waitFor(() =>
      expect(screen.queryByRole('list', {name: 'Setup steps'})).not.toBeInTheDocument(),
    );
  });

  test('reopens the full list on a later visit once the reader expanded it', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);

    const first = renderWithProviders(
      <WorkspaceSetupChecklist workspace={WORKSPACE} />,
      queryClient,
      {capture: vi.fn()},
    );
    fireEvent.click(await screen.findByRole('button', {name: 'Show all 5 steps'}));
    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();
    first.unmount();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Show less'})).toBeInTheDocument();
  });

  test('replaces the panel body with the completion state rather than the finished list', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });
    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });

    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(screen.queryByRole('list', {name: 'Setup steps'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: SHOW_ALL_STEPS_RE})).not.toBeInTheDocument();
  });

  test('replaces an expanded list with the completion state, not just a collapsed one', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });
    fireEvent.click(await screen.findByRole('button', {name: 'Show all 5 steps'}));
    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });

    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(screen.queryByRole('list', {name: 'Setup steps'})).not.toBeInTheDocument();
  });

  test('scopes the remembered expansion to the workspace that was expanded', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    seedQueries(queryClient, false, OTHER_WORKSPACE);

    const expandedHost = renderWithProviders(
      <WorkspaceSetupChecklist workspace={WORKSPACE} />,
      queryClient,
      {capture: vi.fn()},
    );
    fireEvent.click(await screen.findByRole('button', {name: 'Show all 5 steps'}));
    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();
    expandedHost.unmount();

    const otherHost = renderWithProviders(
      <WorkspaceSetupChecklist workspace={OTHER_WORKSPACE} />,
      queryClient,
      {capture: vi.fn()},
    );
    expect(await screen.findByRole('button', {name: 'Show all 5 steps'})).toBeInTheDocument();
    expect(screen.queryByRole('list', {name: 'Setup steps'})).not.toBeInTheDocument();
    otherHost.unmount();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });
    expect(await screen.findByRole('button', {name: 'Show less'})).toBeInTheDocument();
  });

  test('captures the expansion toggle so adoption of the collapsed panel is measurable', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    fireEvent.click(await screen.findByRole('button', {name: 'Show all 5 steps'}));
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_expansion_toggled', {
      host: 'panel',
      expanded: true,
    });

    fireEvent.click(await screen.findByRole('button', {name: 'Show less'}));
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_expansion_toggled', {
      host: 'panel',
      expanded: false,
    });
  });

  test('renders no panel rather than promoting a pointer while optional families load', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
      connection('linear', 'active'),
    ]);

    const fetchImpl = vi.fn(() => pendingResponse());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});

    const {container} = renderWithProviders(
      <WorkspaceSetupChecklist workspace={WORKSPACE} />,
      queryClient,
      {capture: vi.fn()},
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('does not wait on the teammates family, which cannot change the count', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
    ]);
    queryClient.setQueryData(provisionerTokenQueryKeys.active(WORKSPACE.id), {
      provisioners: [],
      installationRunners: 'managed' as const,
    });
    queryClient.setQueryData(modelProviderQueryKeys.catalog(), {
      providers: [],
      workspaceProviders: 'enabled' as const,
      managedProviderId: 'managed-default',
      instanceDefaultProviderId: null,
    });
    queryClient.setQueryData(modelProviderQueryKeys.configs(WORKSPACE.id), {
      configs: [],
      defaultHarnessId: null,
      defaultProviderId: null,
    });
    seedFirstWorkflow(queryClient, {state: 'done'});

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    // Members and invitations are still in flight, and the count is already final.
    expect(await screen.findByText('3 of 4 done')).toBeInTheDocument();
    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
  });

  test('does not render an initially complete checklist without a transition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, true);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    });
    expect(capture).not.toHaveBeenCalledWith('onboarding_checklist_shown', {host: 'panel'});
  });

  test('does not render an initially complete indicator without a transition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, true);

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument();
    });
  });
});

describe('first workflow row', () => {
  beforeEach(() => {
    window.localStorage.clear();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  function captured(capture: ReturnType<typeof vi.fn>, event: string) {
    return capture.mock.calls.filter(([name]) => name === event);
  }

  test('moves from open to test run succeeded to done as the progress changes', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, true, WORKSPACE, {state: 'open'});
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    const checklist = within(await screen.findByRole('region', {name: 'Get started'}));
    expect(await checklist.findByText('Create your first workflow')).toBeInTheDocument();
    expect(checklist.getByText('Your coding agent sets it up from a template')).toBeInTheDocument();
    expect(checklist.getByRole('link', {name: 'Choose a workflow'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}`,
    );

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'test_run_succeeded', testRunId: 'run-1'});
    });

    expect(await screen.findByText('A test run succeeded')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Merge the workflow pull request from your coding agent to turn the workflow on',
      ),
    ).toBeInTheDocument();
    expect(checklist.getByRole('link', {name: 'View run'})).toHaveAttribute('href', '/runs/run-1');
    expect(capture).toHaveBeenCalledWith('first_workflow_test_run_shown', {host: 'panel'});

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'done'});
    });

    // Every other row is done, so the checklist completion carries the only burst.
    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(screen.queryByText('Your first workflow is on')).not.toBeInTheDocument();
    expect(captured(capture, 'onboarding_checklist_completed')).toHaveLength(1);
    expect(captured(capture, 'first_workflow_activated')).toHaveLength(1);
  });

  test('celebrates the first workflow once while another row stays open', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {
      state: 'test_run_succeeded',
      testRunId: 'run-1',
    });
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    // The row sits behind the tools step, so it has not been shown yet.
    expect(captured(capture, 'first_workflow_test_run_shown')).toHaveLength(0);

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'done'});
    });

    expect(await screen.findByText('Your first workflow is on')).toBeInTheDocument();
    expect(screen.getByText('Connect your tools')).toBeInTheDocument();
    expect(screen.queryByText("You're set up")).not.toBeInTheDocument();
    expect(captured(capture, 'first_workflow_activated')).toHaveLength(1);

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'open'});
    });
    act(() => {
      seedFirstWorkflow(queryClient, {state: 'done'});
    });

    await waitFor(() => expect(screen.getAllByText('Your first workflow is on')).toHaveLength(1));
    expect(captured(capture, 'first_workflow_activated')).toHaveLength(1);
    expect(captured(capture, 'onboarding_checklist_completed')).toHaveLength(0);
  });

  test('waits for every family before choosing between the two bursts', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });
    seedQueries(queryClient, true, WORKSPACE, {state: 'open'});
    queryClient.removeQueries({queryKey: listMembersQueryKey(WORKSPACE.id)});
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    const checklist = within(await screen.findByRole('region', {name: 'Get started'}));
    expect(await checklist.findByText('Create your first workflow')).toBeInTheDocument();

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'done'});
    });
    await waitFor(() =>
      expect(screen.queryAllByText('Create your first workflow')).toHaveLength(0),
    );
    expect(screen.queryByText('Your first workflow is on')).not.toBeInTheDocument();
    expect(captured(capture, 'first_workflow_activated')).toHaveLength(0);

    act(() => {
      queryClient.setQueryData(listMembersQueryKey(WORKSPACE.id), []);
    });

    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(screen.queryByText('Your first workflow is on')).not.toBeInTheDocument();
    expect(captured(capture, 'first_workflow_activated')).toHaveLength(1);
  });

  test('plays nothing for a workspace that already had a definition on load', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {state: 'done'});
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    expect(screen.queryByText('Your first workflow is on')).not.toBeInTheDocument();
    expect(captured(capture, 'first_workflow_activated')).toHaveLength(0);
  });

  test('hides the row until the first-workflow read answers', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });
    seedQueries(queryClient, true);
    queryClient.removeQueries({queryKey: firstWorkflowKey()});

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', {name: GET_STARTED_BUTTON_RE})).not.toBeInTheDocument();
    });

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'open'});
    });

    expect(
      await screen.findByRole('button', {name: 'Get started, 3 of 4 done'}),
    ).toBeInTheDocument();
  });

  test('captures the test run row when the popover shows it', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {
      state: 'test_run_succeeded',
      testRunId: 'run-1',
    });
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {capture});

    const trigger = await screen.findByRole('button', {name: 'Get started, 2 of 4 done'});
    expect(captured(capture, 'first_workflow_test_run_shown')).toHaveLength(0);
    fireEvent.click(trigger);

    expect(await screen.findByText('A test run succeeded')).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('first_workflow_test_run_shown', {host: 'popover'});
  });
});

describe('first workflow panel on the home', () => {
  const PANEL_HEADING = {name: 'Create your first workflow'} as const;

  beforeEach(() => {
    window.localStorage.clear();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderHome(queryClient: QueryClient) {
    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });
  }

  async function expectNoPanel() {
    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    expect(screen.queryByRole('heading', PANEL_HEADING)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {name: 'Finish your first workflow'}),
    ).not.toBeInTheDocument();
  }

  test('shows below the checklist for a GitHub-only workspace', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {state: 'open'});

    renderHome(queryClient);

    expect(await screen.findByRole('heading', PANEL_HEADING)).toBeVisible();
    const checklist = within(screen.getByRole('region', {name: 'Get started'}));
    expect(checklist.getByText('Connect your tools')).toBeVisible();
  });

  test('shows the finish mode once a test run succeeded', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {state: 'test_run_succeeded', testRunId: 'run-1'});

    renderHome(queryClient);

    expect(await screen.findByRole('heading', {name: 'Finish your first workflow'})).toBeVisible();
  });

  test('does not show once the workspace has a definition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {state: 'done'});

    renderHome(queryClient);

    await expectNoPanel();
  });

  test.each([
    ['pending', () => pendingResponse()],
    ['failed', () => Promise.reject(new Error('request failed'))],
  ])('does not show while the runner query is %s', async (_state, fetchImpl) => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn(fetchImpl)});
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {state: 'open'});
    queryClient.removeQueries({queryKey: provisionerTokenQueryKeys.active(WORKSPACE.id)});

    renderHome(queryClient);

    await expectNoPanel();
  });

  test.each([
    ['pending', () => pendingResponse()],
    ['failed', () => Promise.reject(new Error('request failed'))],
  ])('does not show while the model query is %s', async (_state, fetchImpl) => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn(fetchImpl)});
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {state: 'open'});
    queryClient.removeQueries({queryKey: modelProviderQueryKeys.catalog()});

    renderHome(queryClient);

    await expectNoPanel();
  });

  test('does not show without runner capacity', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {state: 'open'});
    queryClient.setQueryData(provisionerTokenQueryKeys.active(WORKSPACE.id), {
      provisioners: [],
      installationRunners: 'none' as const,
    });

    renderHome(queryClient);

    await expectNoPanel();
  });

  test('does not show without a model', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, false, WORKSPACE, {state: 'open'});
    queryClient.setQueryData(modelProviderQueryKeys.catalog(), {
      providers: [],
      workspaceProviders: 'enabled' as const,
      managedProviderId: null,
      instanceDefaultProviderId: null,
    });

    renderHome(queryClient);

    await expectNoPanel();
  });
});

describe('lazy chrome slots', () => {
  test('never suspend the host route while the slot loads', async () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn(() => pendingResponse());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    const onRoutePending = vi.fn();
    function RoutePending() {
      onRoutePending();
      return null;
    }

    renderWithProviders(
      <Suspense fallback={<RoutePending />}>
        <WorkspaceSetupIndicatorSlot workspace={WORKSPACE} />
      </Suspense>,
      queryClient,
      {capture: vi.fn()},
    );

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(onRoutePending).not.toHaveBeenCalled();
  });
});
