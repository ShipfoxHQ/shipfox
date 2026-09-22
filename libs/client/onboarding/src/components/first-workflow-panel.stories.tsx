import {agentGrantsQueryOptions} from '@shipfox/client-agent';
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
import {useMemo} from 'react';
import {expect, userEvent, within} from 'storybook/test';
import {FirstWorkflowPanel} from './first-workflow-panel.js';
import type {WorkspaceReference} from './setup-checklist-types.js';

const WORKSPACE: WorkspaceReference = {id: 'story-workspace', slug: 'acme'};

const meta = {
  title: 'Client onboarding/First workflow panel',
  parameters: {layout: 'fullscreen'},
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <PanelStory />,
};

export const Connected: Story = {
  render: () => <PanelStory connectedClientName="Claude Code" />,
};

export const PromptCopied: Story = {
  render: () => <PanelStory />,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Copy prompt'}));
    await expect(canvas.findByRole('button', {name: 'Copied'})).resolves.toBeVisible();
  },
};

function PanelStory({connectedClientName}: {connectedClientName?: string}) {
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
    return client;
  }, [connectedClientName]);
  const router = useMemo(() => {
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

    return createRouter({
      routeTree: rootRoute.addChildren([panelRoute, settingsRoute]),
      history: createMemoryHistory({initialEntries: ['/w/acme']}),
    });
  }, []);

  return (
    <main className="min-h-screen bg-background-subtle-base p-frame">
      <div className="mx-auto w-full max-w-[640px]">
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </div>
    </main>
  );
}
