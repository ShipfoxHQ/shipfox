import type {SecretDto} from '@shipfox/api-secrets-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useEffect, useMemo} from 'react';
import {within} from 'storybook/test';
import {WorkspaceSecretsSection} from './workspace-secrets-section.js';

// Freeze the clock only while a story is mounted so RelativeTime renders a stable
// string in argos snapshots, without leaking the override to other stories.
const FROZEN_NOW = Date.parse('2026-07-02T00:00:00.000Z');
const realDateNow = Date.now;
const withFrozenClock: Decorator = (Story) => {
  Date.now = () => FROZEN_NOW;
  useEffect(
    () => () => {
      Date.now = realDateNow;
    },
    [],
  );
  return <Story />;
};

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const EDITOR_ID = '22222222-2222-4222-8222-222222222222';

const SECRETS: SecretDto[] = [
  {
    key: 'API_TOKEN',
    project_id: null,
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-06-30T12:00:00.000Z',
    last_edited_by: EDITOR_ID,
  },
  {
    key: 'DATABASE_URL',
    project_id: null,
    created_at: '2026-04-01T10:00:00.000Z',
    updated_at: '2026-06-25T12:00:00.000Z',
    last_edited_by: EDITOR_ID,
  },
  {
    key: 'STRIPE_SECRET_KEY',
    project_id: null,
    created_at: '2026-03-01T10:00:00.000Z',
    updated_at: '2026-06-20T12:00:00.000Z',
    last_edited_by: null,
  },
];

type Scenario = 'loaded' | 'empty' | 'loading' | 'error';

const RETRY_BUTTON = /retry/i;

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (() => {
    if (scenario === 'loading') return new Promise<Response>(() => undefined);
    if (scenario === 'error') {
      return Promise.resolve(
        new Response(JSON.stringify({code: 'server-error', message: 'Something failed'}), {
          status: 500,
          headers: {'content-type': 'application/json'},
        }),
      );
    }
    const secrets = scenario === 'empty' ? [] : SECRETS;
    return Promise.resolve(
      new Response(JSON.stringify({secrets, next_cursor: null}), {
        status: 200,
        headers: {'content-type': 'application/json'},
      }),
    );
  }) as unknown as typeof fetch;
}

function SectionStory({scenario}: {scenario: Scenario}) {
  configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: fetchForScenario(scenario)});
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-[720px] p-24">
        <WorkspaceSecretsSection workspaceId={WORKSPACE_ID} />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

const meta: Meta<typeof SectionStory> = {
  title: 'Secrets/WorkspaceSecretsSection',
  component: SectionStory,
  decorators: [withFrozenClock],
};
export default meta;

type Story = StoryObj<typeof SectionStory>;

export const Loaded: Story = {
  args: {scenario: 'loaded'},
  play: async ({canvasElement}) => {
    await within(canvasElement).findByText('API_TOKEN');
  },
};

export const Empty: Story = {
  args: {scenario: 'empty'},
  play: async ({canvasElement}) => {
    await within(canvasElement).findByText('No secrets yet');
  },
};

export const Loading: Story = {
  args: {scenario: 'loading'},
};

export const LoadError: Story = {
  args: {scenario: 'error'},
  play: async ({canvasElement}) => {
    await within(canvasElement).findByRole('button', {name: RETRY_BUTTON});
  },
};
