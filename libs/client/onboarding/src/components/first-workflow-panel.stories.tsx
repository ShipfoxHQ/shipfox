import type {Meta, StoryObj} from '@storybook/react';
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

const meta = {
  title: 'Client onboarding/First workflow panel',
  parameters: {layout: 'fullscreen'},
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <PanelStory />,
};

export const PromptCopied: Story = {
  render: () => <PanelStory />,
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', {name: 'Copy prompt'}));
    await expect(canvas.findByRole('button', {name: 'Copied'})).resolves.toBeVisible();
  },
};

function PanelStory() {
  const router = useMemo(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const panelRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug',
      component: () => <FirstWorkflowPanel workspaceSlug="acme" />,
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
        <RouterProvider router={router} />
      </div>
    </main>
  );
}
