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
