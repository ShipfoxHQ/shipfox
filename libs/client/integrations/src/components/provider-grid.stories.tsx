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
import {expect, within} from 'storybook/test';
import type {IntegrationConnection, IntegrationProvider} from '#core/models.js';
import {ProviderGrid, type ProviderGridProps} from './provider-grid.js';

const SETUP_PATHS = ['linear', 'slack', 'sentry', 'jira', 'notion', 'discord'] as const;

const PROVIDERS: IntegrationProvider[] = [
  {provider: 'linear', displayName: 'Linear', capabilities: ['agent_tools']},
  {provider: 'slack', displayName: 'Slack', capabilities: ['agent_tools']},
  {provider: 'sentry', displayName: 'Sentry', capabilities: []},
  {provider: 'jira', displayName: 'Jira', capabilities: ['agent_tools']},
  {provider: 'notion', displayName: 'Notion', capabilities: ['agent_tools']},
  {provider: 'discord', displayName: 'Discord', capabilities: ['agent_tools']},
];

function connection(
  provider: string,
  overrides: Partial<IntegrationConnection> = {},
): IntegrationConnection {
  return {
    id: `connection-${provider}`,
    workspaceId: 'workspace-1',
    provider,
    externalAccountId: `${provider}-account`,
    slug: `${provider}_account`,
    displayName: `${provider} account`,
    lifecycleStatus: 'active',
    capabilities: ['agent_tools'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function ProviderGridStory(props: Partial<ProviderGridProps>) {
  const router = useMemo(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const gridRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <div className="mx-auto w-full max-w-[760px] bg-background-subtle-base p-24">
          <ProviderGrid
            workspaceSlug="acme"
            providers={PROVIDERS}
            isPending={false}
            emptyMessage="No integrations are available."
            {...props}
          />
        </div>
      ),
    });
    const setupRoutes = SETUP_PATHS.map((provider) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path: `/w/$workspaceSlug/integrations/${provider}`,
        component: () => <div />,
      }),
    );
    return createRouter({
      history: createMemoryHistory({initialEntries: ['/']}),
      routeTree: rootRoute.addChildren([gridRoute, ...setupRoutes]),
    });
  }, [props]);

  return <RouterProvider router={router} />;
}

const meta = {
  title: 'Integrations/Provider grid',
  component: ProviderGridStory,
  parameters: {layout: 'fullscreen'},
} satisfies Meta<typeof ProviderGridStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByRole('link', {name: 'Install Linear'})).toBeVisible();
    expect(canvas.queryByText('Connected')).toBeNull();
  },
};

export const WithConnectedProviders: Story = {
  args: {
    showConnectionState: true,
    returnTo: 'home',
    connections: [connection('linear'), connection('notion')],
  },
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    expect(await canvas.findByRole('link', {name: 'Add another Linear'})).toBeVisible();
    expect(canvas.getAllByText('Connected')).toHaveLength(2);
    expect(canvas.getByRole('link', {name: 'Install Slack'})).toBeVisible();
  },
};

export const AllConnected: Story = {
  args: {
    showConnectionState: true,
    returnTo: 'home',
    connections: PROVIDERS.map(({provider}) => connection(provider)),
  },
};

export const ConnectionStateOffWithConnections: Story = {
  args: {connections: [connection('linear')]},
};
