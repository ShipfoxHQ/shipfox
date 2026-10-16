import {configureApiClient} from '@shipfox/client-api';
import {Button} from '@shipfox/react-ui/button';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo, useState} from 'react';
import {expect, screen, userEvent} from 'storybook/test';
import type {IntegrationConnection} from '#core/models.js';
import {JamConnectModal} from './jam-connect-modal.js';
import {JamConnectionSettings} from './jam-connection-settings.js';
import {JamReplaceTokenModal} from './jam-replace-token-modal.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';

type Scenario =
  | 'connect-form'
  | 'already-connected'
  | 'cli-only-token'
  | 'active-connection'
  | 'error-connection';

interface JamModalsStoryProps {
  scenario: Scenario;
}

function jamConnection(lifecycleStatus: IntegrationConnection['lifecycleStatus']) {
  return {
    id: CONNECTION_ID,
    workspaceId: WORKSPACE_ID,
    provider: 'jam',
    externalAccountId: 'bf9da890-a8ce-4cf6-8627-1e352ddba3c8',
    slug: 'jam',
    displayName: 'Jam',
    lifecycleStatus,
    capabilities: ['agent_tools'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } satisfies IntegrationConnection;
}

function JamModalsStory({scenario}: JamModalsStoryProps) {
  const isSettings = scenario === 'active-connection' || scenario === 'error-connection';
  const [connectOpen, setConnectOpen] = useState(!isSettings);
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
        {isSettings ? (
          <div className="mx-auto w-full max-w-[640px]">
            <JamConnectionSettings
              connection={jamConnection(scenario === 'error-connection' ? 'error' : 'active')}
              workspaceId={WORKSPACE_ID}
            />
          </div>
        ) : (
          <>
            <Button type="button" onClick={() => setConnectOpen(true)}>
              Open connect modal
            </Button>
            <JamConnectModal
              workspaceId={WORKSPACE_ID}
              open={connectOpen}
              onOpenChange={setConnectOpen}
              onOpenReplaceToken={() => {
                setConnectOpen(false);
                setReplaceOpen(true);
              }}
            />
            <JamReplaceTokenModal
              workspaceId={WORKSPACE_ID}
              connection={jamConnection('active')}
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
  title: 'Integrations/JamModals',
  component: JamModalsStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'connect-form'},
} satisfies Meta<typeof JamModalsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectForm: Story = {};

export const AlreadyConnected: Story = {
  args: {scenario: 'already-connected'},
  play: async () => {
    await userEvent.type(await screen.findByLabelText('Personal access token'), 'jam_pat_demo');
    await userEvent.click(screen.getByRole('button', {name: 'Connect'}));
    expect(await screen.findByText('This Jam workspace is already connected')).toBeVisible();
  },
};

export const CliOnlyToken: Story = {
  args: {scenario: 'cli-only-token'},
  play: async () => {
    await userEvent.type(await screen.findByLabelText('Personal access token'), 'jam_pat_demo');
    await userEvent.click(screen.getByRole('button', {name: 'Connect'}));
    expect(
      await screen.findByText(
        'This token has no MCP access. Create a token with MCP read access, not CLI access only.',
      ),
    ).toBeVisible();
  },
};

export const ActiveConnection: Story = {
  args: {scenario: 'active-connection'},
  play: async () => {
    expect(await screen.findByText('Ada Lovelace')).toBeVisible();
  },
};

export const ErrorConnection: Story = {
  args: {scenario: 'error-connection'},
};

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    let response: Response;
    if (request.method === 'GET' && path === `/integrations/jam/connections/${CONNECTION_ID}`) {
      response = jsonResponse({
        user_name: 'Ada Lovelace',
        user_email: 'ada@example.com',
        token_hint: 'k9Qz',
      });
    } else if (path.endsWith('/token')) {
      response = jsonResponse(connectionDto('active'));
    } else if (scenario === 'already-connected') {
      response = jsonResponse(
        {code: 'already-connected', details: {connection_id: CONNECTION_ID}},
        {status: 409},
      );
    } else if (scenario === 'cli-only-token') {
      response = jsonResponse({code: 'missing-read-scope', details: {}}, {status: 400});
    } else {
      response = jsonResponse({connection: connectionDto('active')});
    }
    return Promise.resolve(response);
  };
}

function connectionDto(lifecycleStatus: 'active' | 'error') {
  return {
    id: CONNECTION_ID,
    workspace_id: WORKSPACE_ID,
    provider: 'jam',
    external_account_id: 'bf9da890-a8ce-4cf6-8627-1e352ddba3c8',
    slug: 'jam',
    display_name: 'Jam',
    lifecycle_status: lifecycleStatus,
    capabilities: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
