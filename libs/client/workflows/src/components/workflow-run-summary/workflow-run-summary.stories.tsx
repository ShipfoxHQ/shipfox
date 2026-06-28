import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {RerunMode} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {screen, userEvent, within} from 'storybook/test';
import type {WorkflowRunStatus} from '#core/workflow-run.js';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowRun,
  workflowRunAttemptDto,
  workflowRunDetail,
} from '#test/fixtures/workflow-run.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';

const ROOT_RUN_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_RUN_ID = '22222222-2222-4222-8222-222222222222';
const NEXT_RUN_ID = '33333333-3333-4333-8333-333333333333';
const SWITCH_ATTEMPT_PATTERN = /Switch attempt/;
const ATTEMPT_3_PATTERN = /Attempt 3/;

const withFrame: Decorator = (Story) => (
  <div className="min-h-screen bg-background-neutral-base">
    <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col overflow-hidden border-x border-border-neutral-base bg-background-subtle-base">
      <Story />
      <div className="min-h-0 flex-1 bg-background-neutral-base p-16" />
    </div>
  </div>
);

const withAttemptApi: Decorator = (Story) => {
  configureApiClient({
    baseUrl: 'https://api.example.test',
    fetchImpl: async () =>
      new Response(
        JSON.stringify(
          runAttemptsResponseDto({
            attempts: [
              workflowRunAttemptDto({
                id: ROOT_RUN_ID,
                attempt: 1,
                status: 'succeeded',
                created_at: '2026-06-21T12:00:00.000Z',
              }),
              workflowRunAttemptDto({
                id: CURRENT_RUN_ID,
                attempt: 2,
                status: 'failed',
                created_at: '2026-06-21T12:08:00.000Z',
                rerun_mode: 'all',
              }),
              workflowRunAttemptDto({
                id: NEXT_RUN_ID,
                attempt: 3,
                status: 'running',
                created_at: '2026-06-21T12:14:00.000Z',
                rerun_mode: 'failed',
              }),
            ],
          }),
        ),
        {headers: {'content-type': 'application/json'}},
      ),
  });
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});

  return (
    <QueryClientProvider client={queryClient}>
      <Story />
    </QueryClientProvider>
  );
};

const meta = {
  title: 'Workflows/RunSummary',
  component: WorkflowRunSummary,
  parameters: {
    layout: 'fullscreen',
    argos: {
      modes: {
        light: {theme: 'light'},
        dark: {theme: 'dark'},
      },
    },
  },
  decorators: [withFrame],
  args: {run: workflowRun({status: 'succeeded'})},
} satisfies Meta<typeof WorkflowRunSummary>;

export default meta;
type Story = StoryObj<typeof meta>;
type WorkflowRunSummaryStoryContext = Parameters<NonNullable<Story['play']>>[0];

async function captureOpenAttemptsMenu(ctx: WorkflowRunSummaryStoryContext) {
  const canvas = within(ctx.canvasElement);

  await userEvent.click(await canvas.findByRole('button', {name: SWITCH_ATTEMPT_PATTERN}));
  await screen.findByRole('menu');
  await screen.findByRole('menuitem', {name: ATTEMPT_3_PATTERN});
  await document.fonts.ready;
  await argosScreenshot(ctx, 'Workflow Run Summary Attempts Open');
}

const noop = () => undefined;
const noopRerun = (_mode: RerunMode) => undefined;

export const Default: Story = {};

export const WithSourceButton: Story = {
  args: {
    run: workflowRun({
      status: 'succeeded',
      source_snapshot: {format: 'yaml', content: 'jobs:\n  build:\n    steps: []'},
    }),
    sourceAvailable: true,
    sourceOpen: false,
    sourcePanelId: 'workflow-source-panel',
  },
};

export const SourceOpen: Story = {
  args: {
    run: workflowRun({
      status: 'succeeded',
      source_snapshot: {format: 'yaml', content: 'jobs:\n  build:\n    steps: []'},
    }),
    sourceAvailable: true,
    sourceOpen: true,
    sourcePanelId: 'workflow-source-panel',
  },
};

export const WithAttemptsOpen: Story = {
  decorators: [withAttemptApi],
  play: captureOpenAttemptsMenu,
  args: {
    run: workflowRun({
      id: CURRENT_RUN_ID,
      root_run_id: ROOT_RUN_ID,
      attempt: 2,
      status: 'failed',
    }),
    latestAttempt: 3,
    onSelectAttempt: () => undefined,
  },
};

export const Cancellable: Story = {
  args: {
    run: workflowRun({status: 'running'}),
    onCancel: noop,
  },
};

export const Cancelling: Story = {
  args: {
    run: workflowRun({status: 'running'}),
    onCancel: noop,
    cancelling: true,
  },
};

const ALL_STATUSES: WorkflowRunStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

export const Statuses: Story = {
  render: () => (
    <div className="flex flex-col">
      {ALL_STATUSES.map((status, index) => (
        <WorkflowRunSummary
          key={status}
          run={workflowRun({
            id: `11111111-1111-4111-8111-${String(index + 2).padStart(12, '0')}`,
            status,
            name: `${status}-pipeline`,
          })}
        />
      ))}
    </div>
  ),
};

const ACTION_VARIANTS = [
  {
    label: 'Running',
    run: workflowRun({status: 'running', name: 'running-pipeline'}),
    props: {onCancel: noop},
  },
  {
    label: 'Cancelling',
    run: workflowRun({status: 'running', name: 'cancelling-pipeline'}),
    props: {cancelling: true, onCancel: noop},
  },
  {
    label: 'Succeeded',
    run: workflowRun({status: 'succeeded', name: 'succeeded-pipeline'}),
    props: {onRerun: noopRerun},
  },
  {
    label: 'Re-running',
    run: workflowRun({status: 'succeeded', name: 'rerun-pending-pipeline'}),
    props: {rerunPending: true, onRerun: noopRerun},
  },
  {
    label: 'Failed',
    run: workflowRunDetail({
      status: 'failed',
      name: 'failed-pipeline',
      jobs: [workflowJobDto({status: 'failed'})],
    }),
    props: {onRerun: noopRerun},
  },
  {
    label: 'Cancelled',
    run: workflowRunDetail({
      status: 'cancelled',
      name: 'cancelled-pipeline',
      jobs: [workflowJobDto({status: 'cancelled'})],
    }),
    props: {onRerun: noopRerun},
  },
  {
    label: 'Failed without failed jobs',
    run: workflowRunDetail({
      status: 'failed',
      name: 'failed-without-failed-jobs-pipeline',
      jobs: [workflowJobDto({status: 'succeeded'})],
    }),
    props: {onRerun: noopRerun},
  },
] satisfies Array<{
  label: string;
  run: ReturnType<typeof workflowRun>;
  props: Pick<
    Parameters<typeof WorkflowRunSummary>[0],
    'cancelling' | 'onCancel' | 'rerunPending' | 'onRerun'
  >;
}>;

export const ActionVariantsWithSource: Story = {
  render: () => (
    <div className="flex flex-col">
      {ACTION_VARIANTS.map(({label, run, props}, index) => (
        <WorkflowRunSummary
          key={label}
          run={{
            ...run,
            id: `22222222-2222-4222-8222-${String(index + 2).padStart(12, '0')}`,
          }}
          sourceAvailable
          sourceOpen={label === 'Running'}
          sourcePanelId={`workflow-source-panel-${index}`}
          {...props}
        />
      ))}
    </div>
  ),
};

export const MissingTriggerMetadata: Story = {
  args: {
    run: workflowRun({
      status: 'succeeded',
      trigger_source: '',
      trigger_event: '',
    }),
  },
};

export const EmptyTriggerPayload: Story = {
  args: {
    run: workflowRun({status: 'succeeded', trigger_payload: {}}),
  },
};

export const LongRunName: Story = {
  args: {
    run: workflowRun({
      status: 'succeeded',
      name: 'release-production-multi-region-with-canary-and-smoke-tests-and-progressive-delivery-observability-and-post-deploy-validation-for-enterprise-workspaces',
    }),
  },
};

export const LongTriggerMetadata: Story = {
  args: {
    run: workflowRun({
      status: 'succeeded',
      trigger_source: 'github-enterprise-cloud-production-organization',
      trigger_event: 'workflow_dispatch_with_release_candidate_payload',
    }),
  },
};
