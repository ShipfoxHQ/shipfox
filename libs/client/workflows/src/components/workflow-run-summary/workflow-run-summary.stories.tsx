import type {RerunMode} from '@shipfox/api-workflows-dto';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import type {WorkflowRunStatus} from '#core/workflow-run.js';
import {workflowRun} from '#test/fixtures/workflow-run.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';

const withFrame: Decorator = (Story) => (
  <div className="min-h-screen bg-background-neutral-base">
    <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col overflow-hidden border-x border-border-neutral-base bg-background-subtle-base">
      <Story />
      <div className="min-h-0 flex-1 bg-background-neutral-base p-16" />
    </div>
  </div>
);

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

export const Cancellable: Story = {
  args: {
    run: workflowRun({status: 'running'}),
    onCancel: noop,
  },
};

export const Cancelling: Story = {
  args: {
    run: workflowRun({status: 'running'}),
    cancelling: true,
    onCancel: noop,
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
    run: workflowRun({status: 'failed', name: 'failed-pipeline'}),
    props: {onRerun: noopRerun},
  },
  {
    label: 'Cancelled',
    run: workflowRun({status: 'cancelled', name: 'cancelled-pipeline'}),
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
