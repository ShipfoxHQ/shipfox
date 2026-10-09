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
  finishWorkspaceSetupToolsStep,
  isWorkspaceSetupToolsStepFinished,
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
import {setWorkspaceSetupChecklistExpanded} from '#hooks/use-checklist-expansion.js';
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
const MODEL_ROW = 'Configure a model provider';
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

interface SeedOptions {
  workspace?: WorkspaceReference;
  toolsConnected?: boolean;
  modelConfigured?: boolean;
  firstWorkflow?: FirstWorkflowProgress;
}

function seedModelConfigs(
  queryClient: QueryClient,
  configured: boolean,
  workspace: WorkspaceReference = WORKSPACE,
) {
  queryClient.setQueryData(modelProviderQueryKeys.configs(workspace.id), {
    configs: configured ? [{id: 'model-config'}] : [],
    defaultHarnessId: null,
    defaultProviderId: null,
  });
}

/**
 * The installation provides runners but no model, so the model-provider row is
 * the one that moves. The first workflow defaults to done, which leaves the
 * tools row a pointer and keeps the home on the compact checklist.
 */
function seedQueries(
  queryClient: QueryClient,
  {
    workspace = WORKSPACE,
    toolsConnected = false,
    modelConfigured = false,
    firstWorkflow = {state: 'done'},
  }: SeedOptions = {},
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
    managedProviderId: null,
    instanceDefaultProviderId: null,
  });
  seedModelConfigs(queryClient, modelConfigured, workspace);
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
    '/w/$workspaceSlug/integrations/linear',
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
      toolsStepFinished: false,
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
    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();

    act(() => {
      seedModelConfigs(queryClient, true);
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

    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();
    act(() => {
      seedModelConfigs(queryClient, true);
    });
    expect(await screen.findByText("You're set up")).toBeInTheDocument();

    act(() => {
      seedModelConfigs(queryClient, false);
    });
    await waitFor(() => expect(screen.queryByText("You're set up")).not.toBeInTheDocument());

    act(() => {
      seedModelConfigs(queryClient, true);
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

    fireEvent.click(await screen.findByRole('link', {name: 'Configure'}));

    expect(capture).toHaveBeenCalledWith('onboarding_checklist_row_clicked', {
      row_id: 'model-provider',
    });
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
      seedModelConfigs(queryClient, true);
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
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });
    seedQueries(queryClient);
    queryClient.removeQueries({queryKey: listMembersQueryKey(WORKSPACE.id)});
    queryClient.removeQueries({queryKey: listInvitationsQueryKey(WORKSPACE.id)});

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();
    act(() => {
      seedModelConfigs(queryClient, true);
    });
    await waitFor(() => expect(screen.queryByText(MODEL_ROW)).not.toBeInTheDocument());
    expect(screen.queryByText("You're set up")).not.toBeInTheDocument();

    act(() => {
      queryClient.setQueryData(listMembersQueryKey(WORKSPACE.id), []);
      queryClient.setQueryData(listInvitationsQueryKey(WORKSPACE.id), []);
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
      seedQueries(queryClient, {modelConfigured: true});
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

    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();
    expect(screen.queryByRole('list', {name: 'Setup steps'})).not.toBeInTheDocument();
    expect(screen.queryByText('Create a project')).not.toBeInTheDocument();
    expect(screen.queryByText('Create your first workflow')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', {name: 'Show all steps'});
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
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
    fireEvent.click(await screen.findByRole('button', {name: 'Show all steps'}));
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
    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();

    act(() => {
      seedModelConfigs(queryClient, true);
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
    fireEvent.click(await screen.findByRole('button', {name: 'Show all steps'}));
    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();

    act(() => {
      seedModelConfigs(queryClient, true);
    });

    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(screen.queryByRole('list', {name: 'Setup steps'})).not.toBeInTheDocument();
  });

  test('scopes the remembered expansion to the workspace that was expanded', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);
    seedQueries(queryClient, {workspace: OTHER_WORKSPACE});

    const expandedHost = renderWithProviders(
      <WorkspaceSetupChecklist workspace={WORKSPACE} />,
      queryClient,
      {capture: vi.fn()},
    );
    fireEvent.click(await screen.findByRole('button', {name: 'Show all steps'}));
    expect(await screen.findByRole('list', {name: 'Setup steps'})).toBeInTheDocument();
    expandedHost.unmount();

    const otherHost = renderWithProviders(
      <WorkspaceSetupChecklist workspace={OTHER_WORKSPACE} />,
      queryClient,
      {capture: vi.fn()},
    );
    expect(await screen.findByRole('button', {name: 'Show all steps'})).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole('button', {name: 'Show all steps'}));
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

  test('renders no panel for a remembered expansion while optional families load', async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
    ]);
    queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
      connection('github', 'active'),
      connection('linear', 'active'),
    ]);
    setWorkspaceSetupChecklistExpanded(WORKSPACE.id, true);
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

  test('renders no panel for a finished workspace while the teammates family loads', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true});
    queryClient.removeQueries({queryKey: listMembersQueryKey(WORKSPACE.id)});
    queryClient.removeQueries({queryKey: listInvitationsQueryKey(WORKSPACE.id)});
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
    seedQueries(queryClient);
    queryClient.removeQueries({queryKey: listMembersQueryKey(WORKSPACE.id)});
    queryClient.removeQueries({queryKey: listInvitationsQueryKey(WORKSPACE.id)});

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    // Members and invitations are still in flight, and the count is already final.
    expect(await screen.findByText('3 of 4 done')).toBeInTheDocument();
    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();
  });

  test('does not render an initially complete checklist without a transition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true});
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    await waitFor(() => {
      expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    });
    expect(capture).not.toHaveBeenCalledWith('onboarding_checklist_shown', {host: 'panel'});
  });

  test('does not render an initially complete indicator without a transition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true});

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

  test('moves the row from open to test run succeeded as the progress changes', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {toolsConnected: true, firstWorkflow: {state: 'open'}});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);
    setWorkspaceSetupChecklistExpanded(WORKSPACE.id, true);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    // Without a model no run can succeed, so the home keeps the checklist.
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
  });

  test('completes from the first-workflow panel with the completion burst only', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: {state: 'open'}});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(
      await screen.findByRole('heading', {name: 'Create your first workflow'}),
    ).toBeInTheDocument();

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'done'});
    });

    // The skipped tools row is a pointer, so the first workflow was the last open row.
    expect(await screen.findByText("You're set up")).toBeInTheDocument();
    expect(screen.queryByText('Your first workflow is on')).not.toBeInTheDocument();
    expect(captured(capture, 'onboarding_checklist_completed')).toHaveLength(1);
    expect(captured(capture, 'first_workflow_activated')).toHaveLength(1);
  });

  test('celebrates the first workflow once while another row stays open', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {firstWorkflow: {state: 'test_run_succeeded', testRunId: 'run-1'}});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();
    // The row sits behind the model-provider step, so it has not been shown yet.
    expect(captured(capture, 'first_workflow_test_run_shown')).toHaveLength(0);

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'done'});
    });

    expect(await screen.findByText('Your first workflow is on')).toBeInTheDocument();
    expect(screen.getByText(MODEL_ROW)).toBeInTheDocument();
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
    seedQueries(queryClient, {
      toolsConnected: true,
      modelConfigured: true,
      firstWorkflow: {state: 'open'},
    });
    finishWorkspaceSetupToolsStep(WORKSPACE.id);
    queryClient.removeQueries({queryKey: listMembersQueryKey(WORKSPACE.id)});
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(
      await screen.findByRole('heading', {name: 'Create your first workflow'}),
    ).toBeInTheDocument();

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
    seedQueries(queryClient);
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {capture});

    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();
    expect(screen.queryByText('Your first workflow is on')).not.toBeInTheDocument();
    expect(captured(capture, 'first_workflow_activated')).toHaveLength(0);
  });

  test('hides the row until the first-workflow read answers', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });
    seedQueries(queryClient, {toolsConnected: true, modelConfigured: true});
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
      await screen.findByRole('button', {name: 'Get started, 4 of 5 done'}),
    ).toBeInTheDocument();
  });

  test('captures the test run row when the popover shows it', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {firstWorkflow: {state: 'test_run_succeeded', testRunId: 'run-1'}});
    const capture = vi.fn();

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {capture});

    const trigger = await screen.findByRole('button', {name: 'Get started, 2 of 4 done'});
    expect(captured(capture, 'first_workflow_test_run_shown')).toHaveLength(0);
    fireEvent.click(trigger);

    expect(await screen.findByText('A test run succeeded')).toBeInTheDocument();
    expect(capture).toHaveBeenCalledWith('first_workflow_test_run_shown', {host: 'popover'});
  });
});

describe('tools row in the indicator', () => {
  beforeEach(() => {
    window.localStorage.clear();
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn()});
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  test('counts the tools row while the step is unfinished', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: {state: 'open'}});

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    expect(
      await screen.findByRole('button', {name: 'Get started, 3 of 5 done'}),
    ).toBeInTheDocument();
  });

  test('counts one tracked step fewer once the tools step was skipped', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: {state: 'open'}});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    const trigger = await screen.findByRole('button', {name: 'Get started, 3 of 4 done'});
    fireEvent.click(trigger);

    // The skipped row stays as a pointer with its action.
    expect(await screen.findByText('Connect your tools')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Connect'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/integrations`,
    );
  });

  test('hides the tools row while the first-workflow read is unanswered', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => pendingResponse()),
    });
    seedQueries(queryClient);
    queryClient.removeQueries({queryKey: firstWorkflowKey()});

    renderWithProviders(<WorkspaceSetupIndicator workspace={WORKSPACE} />, queryClient, {
      capture: vi.fn(),
    });

    fireEvent.click(await screen.findByRole('button', {name: GET_STARTED_BUTTON_RE}));

    expect(await screen.findByText(MODEL_ROW)).toBeInTheDocument();
    expect(screen.queryByText('Connect your tools')).not.toBeInTheDocument();
  });
});

describe('home panel', () => {
  const TOOLS_HEADING = {name: 'Connect your tools'} as const;
  const FIRST_WORKFLOW_HEADING = {name: 'Create your first workflow'} as const;
  const OPEN: FirstWorkflowProgress = {state: 'open'};

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

  function renderHome(queryClient: QueryClient, capture = vi.fn()) {
    return renderWithProviders(<WorkspaceSetupChecklist workspace={WORKSPACE} />, queryClient, {
      capture,
    });
  }

  function expectNoToolsPanel() {
    expect(screen.queryByRole('heading', TOOLS_HEADING)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Skip for now'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Continue'})).not.toBeInTheDocument();
  }

  function expectNoFirstWorkflowPanel() {
    expect(screen.queryByRole('heading', FIRST_WORKFLOW_HEADING)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {name: 'Finish your first workflow'}),
    ).not.toBeInTheDocument();
  }

  /** The compact checklist is the only panel on the home. */
  async function expectChecklistOnly() {
    expect(await screen.findByRole('region', {name: 'Get started'})).toBeInTheDocument();
    expectNoToolsPanel();
    expectNoFirstWorkflowPanel();
  }

  test('shows the tools panel alone, with a skip, for a new workspace', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});

    renderHome(queryClient);

    expect(await screen.findByRole('heading', TOOLS_HEADING)).toBeVisible();
    expect(screen.getByRole('button', {name: 'Skip for now'})).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Continue'})).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
    expectNoFirstWorkflowPanel();
  });

  test('lists the tool providers that install through a redirect, returning to the home', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    queryClient.setQueryData(integrationProvidersQueryOptions().queryKey, [
      githubProvider,
      linearProvider,
      {provider: 'posthog', displayName: 'PostHog', capabilities: ['agent_tools']},
    ]);

    renderHome(queryClient);

    expect(await screen.findByRole('link', {name: 'Install Linear'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/integrations/linear?returnTo=home`,
    );
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument();
    expect(screen.queryByText('PostHog')).not.toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Manage in settings'})).toHaveAttribute(
      'href',
      `/w/${WORKSPACE.slug}/settings/integrations`,
    );
  });

  test('keeps the tools panel after the first install and offers to continue', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});

    renderHome(queryClient);
    expect(await screen.findByRole('button', {name: 'Skip for now'})).toBeVisible();

    act(() => {
      queryClient.setQueryData(integrationConnectionsQueryOptions(WORKSPACE.id).queryKey, [
        connection('github', 'active'),
        connection('linear', 'active'),
      ]);
    });

    expect(await screen.findByRole('button', {name: 'Continue'})).toBeVisible();
    expect(screen.getByRole('heading', TOOLS_HEADING)).toBeVisible();
    expect(screen.getByText('Connected')).toBeVisible();
    expect(screen.queryByRole('button', {name: 'Skip for now'})).not.toBeInTheDocument();
    expectNoFirstWorkflowPanel();
  });

  test('shows the tools panel with Continue in a workspace that already has connections', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {toolsConnected: true, modelConfigured: true, firstWorkflow: OPEN});

    renderHome(queryClient);

    expect(await screen.findByRole('heading', TOOLS_HEADING)).toBeVisible();
    expect(screen.getByRole('button', {name: 'Continue'})).toBeVisible();
    expect(screen.getByRole('link', {name: 'Add another Linear'})).toBeVisible();
    expectNoFirstWorkflowPanel();
  });

  test('shows the first-workflow panel only once the tools step is finished', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);

    renderHome(queryClient);

    expect(await screen.findByRole('heading', FIRST_WORKFLOW_HEADING)).toBeVisible();
    expectNoToolsPanel();
    expect(screen.queryByRole('region', {name: 'Get started'})).not.toBeInTheDocument();
  });

  test('skips to the first-workflow panel at once and moves focus to its title', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    const capture = vi.fn();

    renderHome(queryClient, capture);
    fireEvent.click(await screen.findByRole('button', {name: 'Skip for now'}));

    const title = await screen.findByRole('heading', FIRST_WORKFLOW_HEADING);
    expect(title).toHaveFocus();
    expectNoToolsPanel();
    expect(isWorkspaceSetupToolsStepFinished(WORKSPACE.id)).toBe(true);
    expect(capture).toHaveBeenCalledWith('onboarding_tools_step_finished', {
      outcome: 'skipped',
      connected_count: 0,
    });
  });

  test('continues to the first-workflow panel with the connected count', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {toolsConnected: true, modelConfigured: true, firstWorkflow: OPEN});
    const capture = vi.fn();

    renderHome(queryClient, capture);
    fireEvent.click(await screen.findByRole('button', {name: 'Continue'}));

    expect(await screen.findByRole('heading', FIRST_WORKFLOW_HEADING)).toBeVisible();
    expect(capture).toHaveBeenCalledWith('onboarding_tools_step_finished', {
      outcome: 'continued',
      connected_count: 1,
    });
  });

  test('keeps a local skip when browser storage cannot persist it', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    renderHome(queryClient);
    fireEvent.click(await screen.findByRole('button', {name: 'Skip for now'}));

    expect(await screen.findByRole('heading', FIRST_WORKFLOW_HEADING)).toBeVisible();
    expectNoToolsPanel();
  });

  test('moves the indicator count when the tools step is skipped in the same tab', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});

    renderWithProviders(
      <>
        <WorkspaceSetupChecklist workspace={WORKSPACE} />
        <WorkspaceSetupIndicator workspace={WORKSPACE} />
      </>,
      queryClient,
      {capture: vi.fn()},
    );
    expect(
      await screen.findByRole('button', {name: 'Get started, 3 of 5 done'}),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Skip for now'}));

    expect(
      await screen.findByRole('button', {name: 'Get started, 3 of 4 done'}),
    ).toBeInTheDocument();
  });

  test('hides the setup guide from the tools panel', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    const capture = vi.fn();

    const {container} = renderHome(queryClient, capture);
    fireEvent.click(await screen.findByRole('button', {name: 'Hide setup guide'}));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(capture).toHaveBeenCalledWith('onboarding_checklist_dismissed', {host: 'panel'});
  });

  test('hides the setup guide from the first-workflow panel', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);

    const {container} = renderHome(queryClient);
    fireEvent.click(await screen.findByRole('button', {name: 'Hide setup guide'}));

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test('shows the finish mode, and no tools panel, once a test run succeeded', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {
      modelConfigured: true,
      firstWorkflow: {state: 'test_run_succeeded', testRunId: 'run-1'},
    });

    renderHome(queryClient);

    expect(await screen.findByRole('heading', {name: 'Finish your first workflow'})).toBeVisible();
    expectNoToolsPanel();
  });

  test('shows no tools panel once the workspace has a definition', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient);

    renderHome(queryClient);

    await expectChecklistOnly();
  });

  test('renders nothing while the first-workflow read is pending', async () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn(() => pendingResponse());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    seedQueries(queryClient);
    queryClient.removeQueries({queryKey: firstWorkflowKey()});

    const {container} = renderHome(queryClient);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  test('renders nothing at any point for a finished workspace without a tool', async () => {
    const queryClient = createQueryClient();
    const fetchImpl = vi.fn(() => pendingResponse());
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl});
    seedQueries(queryClient, {modelConfigured: true});
    queryClient.removeQueries({queryKey: firstWorkflowKey()});
    const capture = vi.fn();

    const {container} = renderHome(queryClient, capture);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();

    act(() => {
      seedFirstWorkflow(queryClient, {state: 'done'});
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(firstWorkflowKey())).toEqual({state: 'done'}),
    );
    expect(container).toBeEmptyDOMElement();
    expect(capture).not.toHaveBeenCalledWith('onboarding_checklist_shown', {host: 'panel'});
  });

  test('falls back to the compact checklist when the first-workflow read fails', async () => {
    const queryClient = createQueryClient();
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.reject(new Error('request failed'))),
    });
    seedQueries(queryClient, {modelConfigured: true});
    queryClient.removeQueries({queryKey: firstWorkflowKey()});

    renderHome(queryClient);

    // The tools row is the open step of the checklist, not the tools panel.
    const checklist = within(await screen.findByRole('region', {name: 'Get started'}));
    expect(checklist.getByText('Connect your tools')).toBeVisible();
    expectNoToolsPanel();
    expectNoFirstWorkflowPanel();
  });

  test.each([
    ['pending', () => pendingResponse()],
    ['failed', () => Promise.reject(new Error('request failed'))],
  ])('keeps the checklist while the runner query is %s', async (_state, fetchImpl) => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn(fetchImpl)});
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);
    queryClient.removeQueries({queryKey: provisionerTokenQueryKeys.active(WORKSPACE.id)});

    renderHome(queryClient);

    await expectChecklistOnly();
  });

  test.each([
    ['pending', () => pendingResponse()],
    ['failed', () => Promise.reject(new Error('request failed'))],
  ])('keeps the checklist while the model query is %s', async (_state, fetchImpl) => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: vi.fn(fetchImpl)});
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);
    queryClient.removeQueries({queryKey: modelProviderQueryKeys.catalog()});

    renderHome(queryClient);

    await expectChecklistOnly();
  });

  test('keeps the checklist without runner capacity', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {modelConfigured: true, firstWorkflow: OPEN});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);
    queryClient.setQueryData(provisionerTokenQueryKeys.active(WORKSPACE.id), {
      provisioners: [],
      installationRunners: 'none' as const,
    });

    renderHome(queryClient);

    await expectChecklistOnly();
  });

  test('keeps the checklist without a model', async () => {
    const queryClient = createQueryClient();
    seedQueries(queryClient, {firstWorkflow: OPEN});
    finishWorkspaceSetupToolsStep(WORKSPACE.id);

    renderHome(queryClient);

    await expectChecklistOnly();
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
