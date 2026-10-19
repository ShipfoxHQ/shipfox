import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom, ChromeProvider} from '@shipfox/client-shell/runtime';
import {WorkflowRunsPage} from '@shipfox/client-workflows';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useSearch,
} from '@tanstack/react-router';
import {createStore, Provider as JotaiProvider} from 'jotai';
import {useEffect, useMemo, useState} from 'react';
import type {FirstWorkflowProgress} from '#core/setup-checklist.js';
import {firstWorkflowQueryKeys} from '#hooks/api/first-workflow.js';
import {workflowTemplateQueryKeys} from '#hooks/api/workflow-templates.js';
import {githubOnlyWorkflowTemplates} from '#test/fixtures/workflow-templates.js';
import {ProjectFirstWorkflowPanel} from './project-first-workflow-panel.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '99999999-9999-4999-8999-999999999999';

interface Scenario {
  progress: FirstWorkflowProgress;
  devRuns: unknown[];
  definitions: unknown[];
  sync: unknown;
}

const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  workspaces: [{id: WORKSPACE_ID, name: 'Acme', slug: 'acme', membershipId: 'membership-1'}],
};

const meta = {
  title: 'Client onboarding/Runs without a live run',
  parameters: {layout: 'fullscreen'},
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new project: the first-workflow panel above an empty run list. */
export const NewProject: Story = {
  render: () => (
    <RunsStory
      scenario={{
        progress: {state: 'open'},
        devRuns: [],
        definitions: [],
        sync: noWorkflowFilesSync(),
      }}
    />
  ),
};

/** A dev run passed: the panel's finish step above the dev runs. */
export const DevRunPassed: Story = {
  render: () => (
    <RunsStory
      scenario={{
        progress: {state: 'test_run_succeeded', testRunId: devRunId(3)},
        devRuns: agentTestingRuns(),
        definitions: [],
        sync: noWorkflowFilesSync(),
      }}
    />
  ),
};

/** Dev runs in progress, none passed yet. */
export const DevRunsInProgress: Story = {
  render: () => (
    <RunsStory
      scenario={{
        progress: {state: 'open'},
        devRuns: agentTestingRuns().slice(0, 2),
        definitions: [],
        sync: noWorkflowFilesSync(),
      }}
    />
  ),
};

/** Merged workflows that have not run yet. */
export const WaitingForTrigger: Story = {
  render: () => (
    <RunsStory
      scenario={{
        progress: {state: 'done'},
        devRuns: agentTestingRuns(),
        definitions: [
          definitionDto({
            index: 1,
            name: 'Task to pull request',
            path: '.shipfox/workflows/task-to-pr.yml',
            triggers: [{source: 'linear', event: 'issue.labeled'}],
          }),
          definitionDto({
            index: 2,
            name: 'Nightly dependency audit',
            path: '.shipfox/workflows/dependency-audit.yml',
            triggers: [{source: 'cron'}, {source: 'manual', event: 'fire'}],
            manual: true,
          }),
        ],
        sync: succeededSync(),
      }}
    />
  ),
};

/** A sync error that merging cannot fix, shown above everything else. */
export const SyncError: Story = {
  render: () => (
    <RunsStory
      scenario={{
        progress: {state: 'open'},
        devRuns: [],
        definitions: [],
        sync: {
          ...noWorkflowFilesSync(),
          last_error_code: 'provider-access-denied',
          last_error_message:
            'The GitHub installation no longer has access to acme/platform. Reconnect GitHub to resume syncing.',
        },
      }}
    />
  ),
};

function RunsStory({scenario}: {scenario: Scenario}) {
  const [apiConfigured, setApiConfigured] = useState(false);
  useEffect(() => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: (input) => storyFetch(input, scenario),
    });
    setApiConfigured(true);
    return () => resetApiClient();
  }, [scenario]);
  const queryClient = useMemo(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: Infinity}},
    });
    client.setQueryData(agentGrantsQueryOptions().queryKey, [
      {
        id: 'grant-1',
        clientName: 'Claude Code',
        workspaceId: WORKSPACE_ID,
        createdAt: new Date().toISOString(),
        lastRefreshedAt: null,
      },
    ]);
    client.setQueryData(
      workflowTemplateQueryKeys.workspace(WORKSPACE_ID),
      githubOnlyWorkflowTemplates,
    );
    client.setQueryData(
      firstWorkflowQueryKeys.scope({kind: 'project', projectId: PROJECT_ID}),
      scenario.progress,
    );
    return client;
  }, [scenario]);
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(authStateAtom, authState);
    return nextStore;
  }, []);
  const router = useMemo(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const runsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug/p/$projectSlug/runs',
      validateSearch: (search: Record<string, unknown>) =>
        search.origin ? {origin: search.origin as 'synced' | 'dev' | 'all'} : {},
      component: RunsRoute,
    });
    return createRouter({
      routeTree: rootRoute.addChildren([runsRoute]),
      history: createMemoryHistory({initialEntries: ['/w/acme/p/platform/runs']}),
    });
  }, []);

  if (!apiConfigured) return null;

  return (
    <ChromeProvider
      chrome={{
        ProjectBreadcrumb: () => null,
        projectSlugResolver: async () => undefined,
        FirstWorkflowPanel: ProjectFirstWorkflowPanel,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <main className="flex h-screen flex-col bg-background-subtle-base px-frame py-frame">
            <div className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col">
              <RouterProvider router={router} />
            </div>
          </main>
        </JotaiProvider>
      </QueryClientProvider>
    </ChromeProvider>
  );
}

function RunsRoute() {
  const search = useSearch({strict: false}) as {origin?: 'synced' | 'dev' | 'all'};
  return (
    <WorkflowRunsPage
      projectId={PROJECT_ID}
      workspaceSlug="acme"
      projectSlug="platform"
      search={search}
    />
  );
}

// Reads the seeded progress and templates from the cache; anything else the page asks for
// stays pending so it cannot replace the scenario.
function storyFetch(input: RequestInfo | URL, scenario: Scenario): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === '/workflows/runs') {
    const origin = url.searchParams.get('origin');
    const runs = origin === 'synced' ? [] : scenario.devRuns;
    return json({runs, next_cursor: null, filtered_total_count: runs.length});
  }
  if (url.pathname === '/definitions') {
    return json({definitions: scenario.definitions, next_cursor: null, sync: scenario.sync});
  }
  if (url.pathname === `/projects/${PROJECT_ID}`) return json(projectDto());
  if (url.pathname === '/integration-connections') return json(connectionsDto());
  return new Promise<Response>(() => undefined);
}

function json(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: {'content-type': 'application/json'},
    }),
  );
}

function devRunId(index: number) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`;
}

function agentTestingRuns() {
  return [
    devRunDto({index: 1, status: 'running', minutesAgo: 1, jobs: ['succeeded', 'running']}),
    devRunDto({index: 2, status: 'failed', minutesAgo: 9, jobs: ['succeeded', 'failed']}),
    devRunDto({index: 3, status: 'succeeded', minutesAgo: 14, jobs: ['succeeded', 'succeeded']}),
    devRunDto({
      index: 4,
      status: 'failed',
      minutesAgo: 22,
      jobs: ['failed', 'skipped'],
      local: true,
    }),
  ];
}

function devRunDto({
  index,
  status,
  minutesAgo,
  jobs,
  local = false,
}: {
  index: number;
  status: string;
  minutesAgo: number;
  jobs: string[];
  local?: boolean;
}) {
  const createdAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const terminal = status !== 'running' && status !== 'pending';
  return {
    id: devRunId(index),
    project_id: PROJECT_ID,
    definition_id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, '0')}`,
    number: 5 - index,
    name: 'Task to pull request',
    workflow_name: 'Task to pull request',
    status,
    origin: 'dev',
    dev_source: {
      ref: 'shipfox/add-task-to-pr',
      commit: `${String(index).repeat(7)}e4f9a1c2b3d4e5f60718293a4b5c6d7e8f90`.slice(0, 40),
      definition_source: local ? 'local' : 'ref',
      local_actions: [],
      config_path: '.shipfox/workflows/task-to-pr.yml',
      initiated_by_user_id: USER_ID,
      replay_of_event_id: null,
    },
    current_attempt: 1,
    latest_attempt: 1,
    trigger_provider: 'linear',
    trigger_source: 'linear_acme',
    trigger_event: 'issue.labeled',
    trigger_reference: null,
    parent_run: null,
    created_at: createdAt,
    updated_at: createdAt,
    started_at: createdAt,
    finished_at: terminal ? new Date(Date.now() - (minutesAgo - 3) * 60_000).toISOString() : null,
    jobs: jobs.map((jobStatus, position) => ({
      id: `cccccccc-cccc-4ccc-8ccc-${String(index * 10 + position).padStart(12, '0')}`,
      key: position === 0 ? 'implement' : 'open-pull-request',
      name: null,
      status: jobStatus,
      mode: 'one_shot',
      listener_status: 'inactive',
      execution_status: jobStatus === 'running' ? 'running' : null,
      position,
    })),
    job_status_counts: countStatuses(jobs),
    job_display_status_counts: countStatuses(jobs),
    has_started_job_execution: true,
  };
}

function countStatuses(statuses: string[]) {
  const counts = new Map<string, number>();
  for (const status of statuses) counts.set(status, (counts.get(status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => ({status, count}));
}

function definitionDto({
  index,
  name,
  path,
  triggers,
  manual = false,
}: {
  index: number;
  name: string;
  path: string;
  triggers: {source: string; event?: string}[];
  manual?: boolean;
}) {
  return {
    id: `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, '0')}`,
    project_id: PROJECT_ID,
    config_path: path,
    source: 'vcs',
    sha: '9f8e7d6c5b4a39281706f5e4d3c2b1a098765432',
    ref: 'main',
    name,
    workflow_document: {},
    workflow_model: {
      kind: 'workflow',
      name,
      triggers: triggers.map((trigger, position) => ({
        id: `trigger-${position}`,
        key: trigger.source,
        ...trigger,
      })),
      jobs: [],
      dependencies: [],
    },
    manual_trigger: manual ? {name: 'Run now'} : null,
    fetched_at: '2026-10-19T09:00:00.000Z',
    created_at: '2026-10-19T09:00:00.000Z',
    updated_at: '2026-10-19T09:00:00.000Z',
  };
}

function noWorkflowFilesSync() {
  return {
    ref: 'main',
    status: 'failed',
    last_sync_at: '2026-10-19T09:01:00.000Z',
    started_at: '2026-10-19T09:00:58.000Z',
    finished_at: '2026-10-19T09:01:00.000Z',
    last_error_code: 'no-workflow-files',
    last_error_message: 'No workflow files found',
    diagnostics: [],
  };
}

function succeededSync() {
  return {
    ...noWorkflowFilesSync(),
    status: 'succeeded',
    last_error_code: null,
    last_error_message: null,
  };
}

function projectDto() {
  return {
    id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    name: 'Platform',
    slug: 'platform',
    source: {connection_id: CONNECTION_ID, external_repository_id: 'platform'},
    created_at: '2026-10-19T09:00:00.000Z',
    updated_at: '2026-10-19T09:00:00.000Z',
  };
}

function connectionsDto() {
  return {
    connections: [
      {
        id: CONNECTION_ID,
        workspace_id: WORKSPACE_ID,
        provider: 'github',
        external_account_id: 'acme',
        slug: 'github_acme',
        display_name: 'Acme GitHub',
        lifecycle_status: 'active',
        capabilities: ['source_control'],
        created_at: '2026-10-19T09:00:00.000Z',
        updated_at: '2026-10-19T09:00:00.000Z',
      },
    ],
  };
}
