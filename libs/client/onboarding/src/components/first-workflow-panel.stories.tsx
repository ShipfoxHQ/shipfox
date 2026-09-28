import {agentGrantsQueryOptions} from '@shipfox/client-agent';
import {configureApiClient, resetApiClient} from '@shipfox/client-api';
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
import {useEffect, useMemo, useState} from 'react';
import {expect, userEvent, within} from 'storybook/test';
import type {WorkflowTemplate} from '#core/workflow-templates.js';
import {workflowTemplateQueryKeys} from '#hooks/api/workflow-templates.js';
import {
  allToolsWorkflowTemplates,
  githubOnlyWorkflowTemplates,
} from '#test/fixtures/workflow-templates.js';
import {FirstWorkflowPanel, type FirstWorkflowPanelProgress} from './first-workflow-panel.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

const WORKSPACE: WorkspaceReference = {id: 'story-workspace', slug: 'acme'};
const OPEN: FirstWorkflowPanelProgress = {state: 'open'};
const TEST_RUN_SUCCEEDED: FirstWorkflowPanelProgress = {
  state: 'test_run_succeeded',
  testRunId: 'run-1',
};

const meta = {
  title: 'Client onboarding/First workflow panel',
  parameters: {layout: 'fullscreen'},
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const GithubOnly: Story = {
  render: () => (
    <PanelStory templates={githubOnlyWorkflowTemplates} connectedClientName="Claude Code" />
  ),
};

export const AllTools: Story = {
  render: () => (
    <PanelStory templates={allToolsWorkflowTemplates} connectedClientName="Claude Code" />
  ),
};

export const NoGrant: Story = {
  render: () => <PanelStory templates={githubOnlyWorkflowTemplates} />,
};

export const FinishMode: Story = {
  render: () => (
    <PanelStory
      templates={githubOnlyWorkflowTemplates}
      connectedClientName="Claude Code"
      progress={TEST_RUN_SUCCEEDED}
    />
  ),
};

export const FinishModeDifferentWorkflow: Story = {
  render: () => (
    <PanelStory
      templates={githubOnlyWorkflowTemplates}
      connectedClientName="Claude Code"
      progress={TEST_RUN_SUCCEEDED}
    />
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Set up a different workflow'}));
    await expect(canvas.findByText('Task to pull request')).resolves.toBeVisible();
  },
};

export const PromptCopied: Story = {
  render: () => (
    <PanelStory templates={githubOnlyWorkflowTemplates} connectedClientName="Claude Code" />
  ),
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      await canvas.findByRole('button', {name: 'Copy prompt for Task to pull request'}),
    );
    await expect(
      canvas.findByRole('button', {name: 'Copied prompt for Task to pull request'}),
    ).resolves.toBeVisible();
  },
};

function PanelStory({
  templates,
  connectedClientName,
  progress = OPEN,
}: {
  templates: WorkflowTemplate[];
  connectedClientName?: string;
  progress?: FirstWorkflowPanelProgress;
}) {
  const [apiConfigured, setApiConfigured] = useState(false);
  useEffect(() => {
    configureApiClient({baseUrl: 'https://api.example.test'});
    setApiConfigured(true);
    return () => resetApiClient();
  }, []);
  const queryClient = useMemo(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {retry: false, staleTime: Infinity}},
    });
    client.setQueryData(
      agentGrantsQueryOptions().queryKey,
      connectedClientName
        ? [
            {
              id: 'grant-1',
              clientName: connectedClientName,
              workspaceId: WORKSPACE.id,
              createdAt: new Date().toISOString(),
              lastRefreshedAt: null,
            },
          ]
        : [],
    );
    client.setQueryData(workflowTemplateQueryKeys.workspace(WORKSPACE.id), templates);
    return client;
  }, [connectedClientName, templates]);
  const router = useMemo(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const panelRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug',
      component: () => (
        <FirstWorkflowPanel workspace={WORKSPACE} progress={progress} surface="home" />
      ),
    });
    const stubRoutes = ['/w/$workspaceSlug/settings/integrations', '/runs/$workflowRunId'].map(
      (path) => createRoute({getParentRoute: () => rootRoute, path, component: () => null}),
    );

    return createRouter({
      routeTree: rootRoute.addChildren([panelRoute, ...stubRoutes]),
      history: createMemoryHistory({initialEntries: ['/w/acme']}),
    });
  }, [progress]);

  if (!apiConfigured) return null;

  return (
    <main className="min-h-screen bg-background-subtle-base p-frame">
      <div className="mx-auto w-full max-w-[880px]">
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </div>
    </main>
  );
}
