import type {RunResponseDto, RunStatusDto} from '@shipfox/api-workflows-dto';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
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
  args: {run: makeRun()},
} satisfies Meta<typeof WorkflowRunSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

const ALL_STATUSES: RunStatusDto[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled'];

export const Statuses: Story = {
  render: () => (
    <div className="flex flex-col">
      {ALL_STATUSES.map((status, index) => (
        <WorkflowRunSummary
          key={status}
          run={makeRun({
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
    run: makeRun({
      trigger_source: '',
      trigger_event: '',
    }),
  },
};

export const EmptyTriggerPayload: Story = {
  args: {
    run: makeRun({trigger_payload: {}}),
  },
};

export const LongRunName: Story = {
  args: {
    run: makeRun({
      name: 'release-production-multi-region-with-canary-and-smoke-tests-and-progressive-delivery-observability-and-post-deploy-validation-for-enterprise-workspaces',
    }),
  },
};

export const LongTriggerMetadata: Story = {
  args: {
    run: makeRun({
      trigger_source: 'github-enterprise-cloud-production-organization',
      trigger_event: 'workflow_dispatch_with_release_candidate_payload',
    }),
  },
};

function makeRun(overrides: Partial<RunResponseDto> = {}): RunResponseDto {
  return {
    id: '11111111-1111-4111-8111-000000000001',
    project_id: '22222222-2222-4222-8222-222222222222',
    definition_id: '33333333-3333-4333-8333-333333333333',
    name: 'deploy-web',
    status: 'succeeded',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {},
    inputs: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}
