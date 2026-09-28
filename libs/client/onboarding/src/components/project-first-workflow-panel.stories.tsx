import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {type AuthState, authStateAtom, ChromeProvider} from '@shipfox/client-shell/runtime';
import {ProjectWorkflowsPage} from '@shipfox/client-workflows';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {createStore, Provider as JotaiProvider} from 'jotai';
import {useEffect, useMemo, useState} from 'react';
import {expect, within} from 'storybook/test';
import {firstWorkflowQueryKeys} from '#hooks/api/first-workflow.js';
import {workflowTemplateQueryKeys} from '#hooks/api/workflow-templates.js';
import {githubOnlyWorkflowTemplates} from '#test/fixtures/workflow-templates.js';
import {ProjectFirstWorkflowPanel} from './project-first-workflow-panel.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';

const authState: AuthState = {
  status: 'authenticated',
  token: 'token',
  workspaces: [{id: WORKSPACE_ID, name: 'Acme', slug: 'acme', membershipId: 'membership-1'}],
};

const meta = {
  title: 'Client onboarding/Project workflows empty state',
  parameters: {layout: 'fullscreen'},
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** The real workflows page after a sync that found no workflow files, with the panel slotted in. */
export const NoWorkflowFiles: Story = {
  render: () => <EmptyProjectWorkflowsStory />,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.findByText('No workflow files found under .shipfox/workflows/.'),
    ).resolves.toBeVisible();
    await expect(
      canvas.findByRole('heading', {name: 'Create your first workflow'}),
    ).resolves.toBeVisible();
    await expect(canvas.findByText('Acme GitHub')).resolves.toBeVisible();
  },
};

function EmptyProjectWorkflowsStory() {
  const [apiConfigured, setApiConfigured] = useState(false);
  useEffect(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: storyFetch});
    setApiConfigured(true);
    return () => resetApiClient();
  }, []);
  const queryClient = useMemo(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: Infinity}},
    });
    client.setQueryData(agentGrantsQueryOptions().queryKey, []);
    client.setQueryData(
      workflowTemplateQueryKeys.workspace(WORKSPACE_ID),
      githubOnlyWorkflowTemplates,
    );
    client.setQueryData(firstWorkflowQueryKeys.scope({kind: 'project', projectId: PROJECT_ID}), {
      state: 'open',
    });
    return client;
  }, []);
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(authStateAtom, authState);
    return nextStore;
  }, []);
  const router = useMemo(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const workflowsRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug/p/$projectSlug/workflows',
      component: () => <ProjectWorkflowsPage projectId={PROJECT_ID} />,
    });
    return createRouter({
      routeTree: rootRoute.addChildren([workflowsRoute]),
      history: createMemoryHistory({initialEntries: ['/w/acme/p/platform/workflows']}),
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
          <main className="min-h-screen bg-background-subtle-base p-frame">
            <div className="mx-auto w-full max-w-[1120px]">
              <RouterProvider router={router} />
            </div>
          </main>
        </JotaiProvider>
      </QueryClientProvider>
    </ChromeProvider>
  );
}

// The panel's own progress read is seeded above, so its polls stay pending
// rather than replacing the seeded state.
function storyFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === `/projects/${PROJECT_ID}`) return json(projectDto());
  if (url.pathname === '/integration-connections') return json(connectionsDto());
  if (url.pathname === '/definitions' && url.searchParams.get('limit') !== '1') {
    return json(definitionsDto());
  }
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

function projectDto() {
  return {
    id: PROJECT_ID,
    workspace_id: WORKSPACE_ID,
    name: 'Platform',
    slug: 'platform',
    source: {connection_id: CONNECTION_ID, external_repository_id: 'platform'},
    created_at: '2026-09-28T09:00:00.000Z',
    updated_at: '2026-09-28T09:00:00.000Z',
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
        created_at: '2026-09-28T09:00:00.000Z',
        updated_at: '2026-09-28T09:00:00.000Z',
      },
    ],
  };
}

function definitionsDto() {
  return {
    definitions: [],
    next_cursor: null,
    sync: {
      ref: 'main',
      status: 'failed',
      last_sync_at: '2026-09-28T09:01:00.000Z',
      started_at: '2026-09-28T09:00:58.000Z',
      finished_at: '2026-09-28T09:01:00.000Z',
      last_error_code: 'no-workflow-files',
      last_error_message: 'No workflow files found',
      diagnostics: [],
    },
  };
}
