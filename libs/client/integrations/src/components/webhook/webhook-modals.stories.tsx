import type {WebhookConnectionDto} from '@shipfox/api-integration-webhook-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Modal, ModalContent, ModalHeader, ModalTitle, Toaster} from '@shipfox/react-ui';
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
import type {ReactNode} from 'react';
import {useMemo} from 'react';
import {CopyableValue} from './copyable-value.js';
import {WebhookCreateModal, WebhookCreateSuccessContent} from './webhook-create-modal.js';
import {WebhookDeleteConfirmContent, WebhookManageModal} from './webhook-manage-modal.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '77777777-7777-4777-8777-777777777777';

type Scenario =
  | 'create-form'
  | 'create-success'
  | 'manage-active'
  | 'manage-disabled'
  | 'delete-confirm'
  | 'copyable-value';

interface WebhookModalStoryProps {
  scenario: Scenario;
}

const activeConnection: WebhookConnectionDto = {
  id: CONNECTION_ID,
  workspace_id: WORKSPACE_ID,
  name: 'Stripe production',
  slug: 'stripe-prod',
  lifecycle_status: 'active',
  inbound_url: 'https://api.example.test/webhook/77777777-7777-4777-8777-777777777777',
  created_at: '2026-04-12T00:00:00.000Z',
  updated_at: '2026-04-12T00:00:00.000Z',
};

const disabledConnection: WebhookConnectionDto = {
  ...activeConnection,
  lifecycle_status: 'disabled',
};

function WebhookModalStory({scenario}: WebhookModalStoryProps) {
  const connection = scenario === 'manage-disabled' ? disabledConnection : activeConnection;

  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForConnection(connection),
  });

  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  const router = useMemo(() => createStoryRouter(scenario), [scenario]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Integrations/WebhookModals',
  component: WebhookModalStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'create-form'},
} satisfies Meta<typeof WebhookModalStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const CreateSuccess: Story = {
  args: {scenario: 'create-success'},
};

export const ManageActive: Story = {
  args: {scenario: 'manage-active'},
};

export const ManageDisabled: Story = {
  args: {scenario: 'manage-disabled'},
};

export const DeleteConfirm: Story = {
  args: {scenario: 'delete-confirm'},
};

export const CopyableValueState: Story = {
  args: {scenario: 'copyable-value'},
};

function StoryModal({title, children}: {title: string; children: ReactNode}) {
  return (
    <Modal open onOpenChange={() => undefined}>
      <ModalContent aria-describedby={undefined}>
        <ModalTitle className="sr-only">{title}</ModalTitle>
        <ModalHeader title={title} />
        {children}
      </ModalContent>
    </Modal>
  );
}

function StorySurface({scenario}: {scenario: Scenario}) {
  return (
    <div className="min-h-screen bg-background-neutral-background p-24">
      {scenario === 'create-form' ? (
        <WebhookCreateModal workspaceId={WORKSPACE_ID} open onOpenChange={() => undefined} />
      ) : null}
      {scenario === 'create-success' ? (
        <StoryModal title="Webhook created">
          <WebhookCreateSuccessContent connection={activeConnection} onDone={() => undefined} />
        </StoryModal>
      ) : null}
      {scenario === 'manage-active' || scenario === 'manage-disabled' ? (
        <WebhookManageModal
          workspaceId={WORKSPACE_ID}
          connectionId={CONNECTION_ID}
          open
          onOpenChange={() => undefined}
        />
      ) : null}
      {scenario === 'delete-confirm' ? (
        <StoryModal title="Delete webhook">
          <WebhookDeleteConfirmContent
            name={activeConnection.name}
            isPending={false}
            onCancel={() => undefined}
            onConfirm={() => undefined}
          />
        </StoryModal>
      ) : null}
      {scenario === 'copyable-value' ? (
        <div className="mx-auto max-w-[560px] rounded-8 border border-border-neutral-base bg-background-neutral-base p-24">
          <CopyableValue
            label="inbound URL"
            value={activeConnection.inbound_url}
            note="Anyone with this URL can trigger your workflow."
          />
        </div>
      ) : null}
    </div>
  );
}

function createStoryRouter(scenario: Scenario) {
  const rootRoute = createRootRoute({component: Outlet});
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/workspaces/$wid',
    component: Outlet,
  });
  const integrationsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'settings/integrations',
    component: () => <StorySurface scenario={scenario} />,
  });
  const eventsRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: 'settings/events',
    component: () => <div />,
  });

  return createRouter({
    history: createMemoryHistory({
      initialEntries: [`/workspaces/${WORKSPACE_ID}/settings/integrations`],
    }),
    routeTree: rootRoute.addChildren([
      workspaceRoute.addChildren([integrationsRoute, eventsRoute]),
    ]),
  });
}

function fetchForConnection(connection: WebhookConnectionDto): typeof fetch {
  return (input) => {
    const url = requestUrl(input);
    if (url.pathname === '/integrations/webhook/connections') {
      return Promise.resolve(jsonResponse({connections: [connection]}));
    }
    return Promise.resolve(jsonResponse({}, {status: 404}));
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
