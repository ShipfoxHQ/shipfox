import type {
  IntegrationConnectionDto,
  IntegrationProviderDto,
} from '@shipfox/api-integration-core-dto';
import {configureApiClient} from '@shipfox/client-api';
import {authStateAtom} from '@shipfox/client-auth';
import {Toaster} from '@shipfox/react-ui';
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
import {useMemo} from 'react';
import {IntegrationGallery} from './integration-gallery.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_PATH = `/workspaces/${WORKSPACE_ID}/settings/integrations`;
const SETUP_PATHS = [
  '/workspaces/$wid/integrations/github',
  '/workspaces/$wid/integrations/sentry',
  '/workspaces/$wid/integrations/gitea',
  '/workspaces/$wid/integrations/debug',
] as const;

type Scenario =
  | 'mixed'
  | 'empty-connections'
  | 'loading'
  | 'connections-error'
  | 'providers-error'
  | 'no-providers'
  | 'long-names';

interface IntegrationGalleryStoryProps {
  scenario: Scenario;
}

const PROVIDERS: IntegrationProviderDto[] = [
  {provider: 'github', display_name: 'GitHub', capabilities: ['source_control']},
  {provider: 'sentry', display_name: 'Sentry', capabilities: []},
  {provider: 'gitea', display_name: 'Gitea', capabilities: ['source_control']},
  {provider: 'debug', display_name: 'Debug provider', capabilities: []},
];

function IntegrationGalleryStory({scenario}: IntegrationGalleryStoryProps) {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForScenario(scenario),
  });

  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  const store = useMemo(() => {
    const nextStore = createStore();
    nextStore.set(authStateAtom, {
      status: 'authenticated',
      workspaces: [{id: WORKSPACE_ID, name: 'Acme', membershipId: 'membership-1'}],
    });
    return nextStore;
  }, []);
  const router = useMemo(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const workspaceRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/workspaces/$wid',
      component: Outlet,
    });
    const galleryRoute = createRoute({
      getParentRoute: () => workspaceRoute,
      path: 'settings/integrations',
      component: () => (
        <div className="mx-auto w-full max-w-[760px] bg-background-neutral-background p-24">
          <IntegrationGallery workspaceId={WORKSPACE_ID} />
        </div>
      ),
    });
    const setupRoutes = SETUP_PATHS.map((path) =>
      createRoute({
        getParentRoute: () => workspaceRoute,
        path: path.replace('/workspaces/$wid/', ''),
        component: () => <div />,
      }),
    );

    return createRouter({
      history: createMemoryHistory({initialEntries: [WORKSPACE_PATH]}),
      routeTree: rootRoute.addChildren([
        workspaceRoute.addChildren([galleryRoute, ...setupRoutes]),
      ]),
    });
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <RouterProvider router={router} />
        <Toaster />
      </JotaiProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Integrations/Gallery',
  component: IntegrationGalleryStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'mixed'},
} satisfies Meta<typeof IntegrationGalleryStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const EmptyConnections: Story = {
  args: {scenario: 'empty-connections'},
};

export const Loading: Story = {
  args: {scenario: 'loading'},
};

export const ConnectionsError: Story = {
  args: {scenario: 'connections-error'},
};

export const ProvidersError: Story = {
  args: {scenario: 'providers-error'},
};

export const NoProvidersAvailable: Story = {
  args: {scenario: 'no-providers'},
};

export const LongNames: Story = {
  args: {scenario: 'long-names'},
};

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (input) => {
    const url = requestUrl(input);
    if (scenario === 'loading') return new Promise<Response>(() => undefined);
    if (url.pathname === '/integration-providers') {
      if (scenario === 'providers-error') return Promise.resolve(errorResponse());
      return Promise.resolve(
        jsonResponse({providers: scenario === 'no-providers' ? [] : PROVIDERS}),
      );
    }
    if (url.pathname === '/integration-connections') {
      if (scenario === 'connections-error') return Promise.resolve(errorResponse());
      return Promise.resolve(jsonResponse({connections: connectionsForScenario(scenario)}));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
  };
}

function connectionsForScenario(scenario: Scenario): IntegrationConnectionDto[] {
  if (scenario === 'empty-connections' || scenario === 'no-providers') return [];
  if (scenario === 'long-names') {
    return [
      connection({
        display_name: 'acme-production-observability-and-source-control-organization',
        lifecycle_status: 'active',
      }),
      connection({
        id: '55555555-5555-4555-8555-555555555555',
        provider: 'sentry',
        display_name: 'sentry-team-with-a-very-long-connected-account-name',
        lifecycle_status: 'error',
      }),
    ];
  }
  return [
    connection({display_name: 'acme-corp', lifecycle_status: 'active'}),
    connection({
      id: '55555555-5555-4555-8555-555555555555',
      provider: 'gitea',
      display_name: 'platform-mirror',
      lifecycle_status: 'disabled',
    }),
    connection({
      id: '66666666-6666-4666-8666-666666666666',
      provider: 'sentry',
      display_name: 'sentry-prod',
      lifecycle_status: 'error',
    }),
  ];
}

function connection(overrides: Partial<IntegrationConnectionDto> = {}): IntegrationConnectionDto {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspace_id: WORKSPACE_ID,
    provider: 'github',
    external_account_id: 'installation-1',
    slug: 'github_acme_corp',
    display_name: 'acme-corp',
    lifecycle_status: 'active',
    capabilities: ['source_control'],
    external_url: 'https://github.com/organizations/acme-corp/settings/installations/1',
    created_at: '2026-03-12T00:00:00.000Z',
    updated_at: '2026-03-12T00:00:00.000Z',
    ...overrides,
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}

function errorResponse() {
  return jsonResponse({code: 'server-error'}, {status: 500, statusText: 'Server error'});
}
