import type {VariableDto} from '@shipfox/api-secrets-dto';
import {configureApiClient} from '@shipfox/client-api';
import {Toaster} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo} from 'react';
import {within} from 'storybook/test';
import {WorkspaceVariablesSection} from './workspace-variables-section.js';

// Freeze the clock so RelativeTime renders a stable string in argos snapshots.
const FROZEN_NOW = Date.parse('2026-07-02T00:00:00.000Z');
Date.now = () => FROZEN_NOW;

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const EDITOR_ID = '22222222-2222-4222-8222-222222222222';

const VARIABLES: VariableDto[] = [
  {
    key: 'LOG_LEVEL',
    value: 'debug',
    project_id: null,
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-06-30T12:00:00.000Z',
    last_edited_by: EDITOR_ID,
  },
  {
    key: 'FEATURE_FLAG',
    value: '',
    project_id: null,
    created_at: '2026-04-01T10:00:00.000Z',
    updated_at: '2026-06-25T12:00:00.000Z',
    last_edited_by: EDITOR_ID,
  },
  {
    key: 'REGION',
    value: 'eu-west-1',
    project_id: null,
    created_at: '2026-03-01T10:00:00.000Z',
    updated_at: '2026-06-20T12:00:00.000Z',
    last_edited_by: null,
  },
];

type Scenario = 'loaded' | 'empty';

function fetchForScenario(scenario: Scenario): typeof fetch {
  return (() => {
    const variables = scenario === 'empty' ? [] : VARIABLES;
    return Promise.resolve(
      new Response(JSON.stringify({variables, next_cursor: null}), {
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
        <WorkspaceVariablesSection workspaceId={WORKSPACE_ID} />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

const meta: Meta<typeof SectionStory> = {
  title: 'Secrets/WorkspaceVariablesSection',
  component: SectionStory,
};
export default meta;

type Story = StoryObj<typeof SectionStory>;

export const Loaded: Story = {
  args: {scenario: 'loaded'},
  play: async ({canvasElement}) => {
    await within(canvasElement).findByText('LOG_LEVEL');
  },
};

export const Empty: Story = {
  args: {scenario: 'empty'},
  play: async ({canvasElement}) => {
    await within(canvasElement).findByText('No variables yet');
  },
};
