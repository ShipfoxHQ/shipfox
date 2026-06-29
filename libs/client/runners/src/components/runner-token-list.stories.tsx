import type {RunnerTokenDto} from '@shipfox/api-runners-dto';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useMemo} from 'react';
import {EmptyRunnerTokens, RunnerTokenList, RunnerTokenTableSkeleton} from './runner-token-list.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function RunnerTokenListStory({tokens}: {tokens: RunnerTokenDto[]}) {
  const queryClient = useMemo(
    () => new QueryClient({defaultOptions: {queries: {retry: false}}}),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <div className="mx-auto w-full max-w-[860px] bg-background-neutral-background p-24">
        <RunnerTokenList workspaceId={WORKSPACE_ID} tokens={tokens} />
      </div>
    </QueryClientProvider>
  );
}

const meta = {
  title: 'Runners/Token list',
  component: RunnerTokenListStory,
  parameters: {layout: 'fullscreen'},
  args: {tokens: runnerTokens()},
} satisfies Meta<typeof RunnerTokenListStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveTokens: Story = {};

export const LongNames: Story = {
  args: {
    tokens: [
      runnerToken({
        name: 'mac-stadium-prod-runner-with-extra-long-registration-name',
        prefix: 'sf_rt_very_long_prefix_12',
      }),
      runnerToken({
        id: '22222222-2222-4222-8222-222222222222',
        name: null,
        prefix: 'sf_rt_unnamed_19',
        expires_at: null,
      }),
    ],
  },
};

export const Empty: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[860px] bg-background-neutral-background p-24">
      <EmptyRunnerTokens />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="mx-auto w-full max-w-[860px] bg-background-neutral-background p-24">
      <RunnerTokenTableSkeleton />
    </div>
  ),
};

function runnerTokens(): RunnerTokenDto[] {
  return [
    runnerToken({name: 'Production macOS runner', prefix: 'sf_rt_prod_2x'}),
    runnerToken({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Linux build pool',
      prefix: 'sf_rt_linux_7q',
      created_at: '2026-06-20T09:12:00.000Z',
      updated_at: '2026-06-20T09:12:00.000Z',
      expires_at: null,
    }),
    runnerToken({
      id: '33333333-3333-4333-8333-333333333333',
      name: null,
      prefix: 'sf_rt_shared_4m',
      created_at: '2026-06-10T16:30:00.000Z',
      updated_at: '2026-06-10T16:30:00.000Z',
      expires_at: '2026-07-10T16:30:00.000Z',
    }),
  ];
}

function runnerToken(overrides: Partial<RunnerTokenDto> = {}): RunnerTokenDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspace_id: WORKSPACE_ID,
    prefix: 'sf_rt_local_8f',
    name: 'Local runner',
    expires_at: '2026-07-01T12:00:00.000Z',
    revoked_at: null,
    created_at: '2026-06-18T12:00:00.000Z',
    updated_at: '2026-06-18T12:00:00.000Z',
    ...overrides,
  };
}
