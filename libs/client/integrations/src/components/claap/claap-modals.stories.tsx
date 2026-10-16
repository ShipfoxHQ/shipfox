import {configureApiClient} from '@shipfox/client-api';
import {Button} from '@shipfox/react-ui/button';
import {Toaster} from '@shipfox/react-ui/toast';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo, useState} from 'react';
import {expect, screen, userEvent} from 'storybook/test';
import type {IntegrationConnection} from '#core/models.js';
import {ClaapConnectModal} from './claap-connect-modal.js';
import {ClaapConnectionSettings} from './claap-connection-settings.js';
import {ClaapReplaceApiKeyModal} from './claap-replace-api-key-modal.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CONNECTION_ID = '22222222-2222-4222-8222-222222222222';

type Scenario = 'connect-form' | 'invalid-key' | 'already-connected' | 'error-connection';

interface ClaapModalsStoryProps {
  scenario: Scenario;
}

const claapConnection: IntegrationConnection = {
  id: CONNECTION_ID,
  workspaceId: WORKSPACE_ID,
  provider: 'claap',
  externalAccountId: 'q2IqD9wUHb',
  slug: 'claap_mercateam',
  displayName: 'Claap Mercateam',
  lifecycleStatus: 'error',
  capabilities: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function ClaapModalsStory({scenario}: ClaapModalsStoryProps) {
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
            <ClaapConnectionSettings connection={claapConnection} workspaceId={WORKSPACE_ID} />
          </div>
        ) : (
          <>
            <Button type="button" onClick={() => setConnectOpen(true)}>
              Open connect modal
            </Button>
            <ClaapConnectModal
              workspaceId={WORKSPACE_ID}
              open={connectOpen}
              onOpenChange={setConnectOpen}
              onOpenReplaceApiKey={() => {
                setConnectOpen(false);
                setReplaceOpen(true);
              }}
            />
            <ClaapReplaceApiKeyModal
              workspaceId={WORKSPACE_ID}
              connection={claapConnection}
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
  title: 'Integrations/ClaapModals',
  component: ClaapModalsStory,
  parameters: {layout: 'fullscreen'},
  args: {scenario: 'connect-form'},
} satisfies Meta<typeof ClaapModalsStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ConnectForm: Story = {};

export const InvalidKey: Story = {
  args: {scenario: 'invalid-key'},
  play: async () => {
    await userEvent.type(await screen.findByLabelText('API key'), 'cla_revoked');
    await userEvent.click(screen.getByRole('button', {name: 'Connect'}));
    expect(await screen.findByLabelText('API key')).toHaveAttribute('aria-invalid', 'true');
  },
};

export const AlreadyConnected: Story = {
  args: {scenario: 'already-connected'},
  play: async () => {
    await userEvent.type(await screen.findByLabelText('API key'), 'cla_demo');
    await userEvent.click(screen.getByRole('button', {name: 'Connect'}));
    expect(await screen.findByText('This Claap workspace is already connected')).toBeVisible();
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
    } else if (scenario === 'invalid-key') {
      response = jsonResponse({code: 'invalid-api-key', details: {}}, {status: 400});
    } else if (scenario === 'already-connected') {
      response = jsonResponse(
        {code: 'already-connected', details: {connection_id: CONNECTION_ID}},
        {status: 409},
      );
    } else {
      response = jsonResponse({
        connection: {
          id: CONNECTION_ID,
          workspace_id: WORKSPACE_ID,
          provider: 'claap',
          external_account_id: 'q2IqD9wUHb',
          slug: 'claap_mercateam',
          display_name: 'Claap Mercateam',
          lifecycle_status: 'active',
          capabilities: [],
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
