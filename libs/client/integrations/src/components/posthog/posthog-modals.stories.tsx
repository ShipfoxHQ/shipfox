import {configureApiClient} from '@shipfox/client-api';
import {Button} from '@shipfox/react-ui/button';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo, useState} from 'react';
import {expect, screen, userEvent} from 'storybook/test';
import type {IntegrationConnection} from '#core/models.js';
import {PosthogConnectionSettings} from '#pages/connection-details-page.js';
import {PosthogConnectModal} from './posthog-connect-modal.js';
import {PosthogReplaceApiKeyModal} from './posthog-replace-api-key-modal.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';

type Scenario = 'connect-form' | 'project-picker' | 'already-connected' | 'error-connection';

interface PosthogModalsStoryProps {
  scenario: Scenario;
}

const posthogConnection: IntegrationConnection = {
  id: CONNECTION_ID,
  workspaceId: WORKSPACE_ID,
  provider: 'posthog',
  externalAccountId: 'eu:project-1',
  slug: 'posthog_analytics',
  displayName: 'Analytics',
  lifecycleStatus: 'error',
  capabilities: ['agent_tools'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function PosthogModalsStory({scenario}: PosthogModalsStoryProps) {
  const [connectOpen, setConnectOpen] = useState(scenario !== 'error-connection');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}}),
    [],
  );
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: fetchForScenario(scenario),
  });

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-background-subtle-base p-24">
        {scenario === 'error-connection' ? (
          <div className="mx-auto w-full max-w-[640px]">
            <PosthogConnectionSettings connection={posthogConnection} workspaceId={WORKSPACE_ID} />
          </div>
        ) : (
          <>
            <Button type="button" onClick={() => setConnectOpen(true)}>
              Open connect modal
            </Button>
            <PosthogConnectModal
              workspaceId={WORKSPACE_ID}
              open={connectOpen}
              onOpenChange={setConnectOpen}
              onOpenReplaceApiKey={() => {
                setConnectOpen(false);
                setReplaceOpen(true);
              }}
            />
            <PosthogReplaceApiKeyModal
              workspaceId={WORKSPACE_ID}
              connection={posthogConnection}
              open={replaceOpen}
              onOpenChange={setReplaceOpen}
            />
          </>
        )}
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Integrations/PostHogModals',
  component: PosthogModalsStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'connect-form'},
} satisfies Meta<typeof PosthogModalsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectForm: Story = {};

export const ProjectPicker: Story = {
  args: {scenario: 'project-picker'},
  play: async () => {
    await userEvent.type(await screen.findByLabelText('Personal API key'), 'phx_demo');
    await userEvent.click(screen.getByRole('button', {name: 'Connect'}));
    expect(await screen.findByText('Choose a PostHog project')).toBeVisible();
  },
};

export const AlreadyConnected: Story = {
  args: {scenario: 'already-connected'},
  play: async () => {
    await userEvent.type(await screen.findByLabelText('Personal API key'), 'phx_demo');
    await userEvent.click(screen.getByRole('button', {name: 'Connect'}));
    expect(await screen.findByText('This project is already connected')).toBeVisible();
  },
};

export const ErrorConnection: Story = {
  args: {scenario: 'error-connection'},
};

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (input, init) => {
    const request = new Request(input, init);
    let response: Response;
    if (request.url.endsWith('/api-key')) {
      response = new Response(undefined, {status: 204});
    } else if (scenario === 'project-picker') {
      response = jsonResponse({
        status: 'select-project',
        projects: [{id: 'project-1', name: 'Analytics'}],
      });
    } else if (scenario === 'already-connected') {
      response = jsonResponse(
        {status: 'already-connected', connection_id: CONNECTION_ID, code: 'already-connected'},
        {status: 409},
      );
    } else {
      response = jsonResponse({
        status: 'connected',
        connection: {
          id: CONNECTION_ID,
          workspace_id: WORKSPACE_ID,
          provider: 'posthog',
          external_account_id: 'eu:project-1',
          slug: 'posthog_analytics',
          display_name: 'Analytics',
          lifecycle_status: 'active',
          capabilities: ['agent_tools'],
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      });
    }
    return Promise.resolve(response);
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
