import type {RunJobDetailDto} from '@shipfox/api-workflows-dto';
import type {Meta, StoryObj} from '@storybook/react';
import type {KeyboardEventHandler} from 'react';
import type {WorkflowJobStatus} from '#core/workflow-run.js';
import {workflowJob} from '#test/fixtures/workflow-run.js';
import type {WorkflowJobGraphNode} from './graph-model.js';
import {WorkflowJobNode} from './workflow-job-node.js';

const statuses: WorkflowJobStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
];
const ignoreKeyDown: KeyboardEventHandler<HTMLButtonElement> = () => undefined;
const storyNodes = [
  ...statuses.map((status, index) =>
    makeNode({
      id: `job-${status}`,
      label: `${status}-job`,
      status,
      position: index,
      dependencies: index === 0 ? [] : ['build'],
    }),
  ),
  makeNode({
    id: 'job-long-name',
    label: 'release-production-multi-region-with-canary-and-smoke-tests',
    status: 'pending',
    position: 5,
    dependencies: [],
  }),
  makeNode({
    id: 'job-multiple-dependencies',
    label: 'deploy',
    status: 'pending',
    position: 6,
    dependencies: ['build', 'lint'],
  }),
  makeNode({
    id: 'job-no-dependencies',
    label: 'manual-approval',
    status: 'succeeded',
    position: 7,
    dependencies: [],
  }),
];

const meta = {
  title: 'Workflows/JobNode',
  component: WorkflowJobNode,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WorkflowJobNode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllStatuses: Story = {
  render: () => (
    <div className="grid w-720 grid-cols-2 gap-12">
      {storyNodes.map((node) => (
        <WorkflowJobNode
          key={node.id}
          node={node}
          selected={node.status === 'running'}
          onSelect={() => undefined}
          onKeyDown={ignoreKeyDown}
        />
      ))}
    </div>
  ),
};

// Storybook freezes `Date.now()` at 2026-06-26T12:00:00Z (see `.storybook/preview.tsx`),
// so anchors near that instant render deterministic live durations for Argos.
const QUEUED_AT = '2026-06-26T11:54:00.000Z'; // queued 6m
const STARTED_AT = '2026-06-26T11:57:46.000Z'; // running 2m 14s
const FINISHED_AT = '2026-06-26T12:00:00.000Z'; // started→finished span 2m 14s

const durationNodes = [
  makeNode({
    id: 'job-queued',
    label: 'queued-job',
    status: 'pending',
    position: 0,
    dependencies: [],
    queuedAt: QUEUED_AT,
  }),
  makeNode({
    id: 'job-running',
    label: 'running-job',
    status: 'running',
    position: 1,
    dependencies: [],
    queuedAt: QUEUED_AT,
    startedAt: STARTED_AT,
  }),
  makeNode({
    id: 'job-finished',
    label: 'finished-job',
    status: 'succeeded',
    position: 2,
    dependencies: [],
    queuedAt: QUEUED_AT,
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
  }),
  makeNode({
    id: 'job-skipped',
    label: 'skipped-job',
    status: 'skipped',
    position: 3,
    dependencies: [],
  }),
  makeNode({
    id: 'job-terminal-no-finish',
    label: 'crashed-job',
    status: 'failed',
    position: 4,
    dependencies: [],
    queuedAt: QUEUED_AT,
    startedAt: STARTED_AT,
  }),
  makeNode({
    id: 'job-long-name-running',
    label: 'release-production-multi-region-with-canary-and-smoke-tests',
    status: 'running',
    position: 5,
    dependencies: [],
    queuedAt: QUEUED_AT,
    startedAt: STARTED_AT,
  }),
];

export const WithDurations: Story = {
  render: () => (
    <div className="grid w-720 grid-cols-2 gap-12">
      {durationNodes.map((node) => (
        <WorkflowJobNode
          key={node.id}
          node={node}
          selected={false}
          onSelect={() => undefined}
          onKeyDown={ignoreKeyDown}
        />
      ))}
    </div>
  ),
};

function makeNode({
  id,
  label,
  status,
  position,
  dependencies,
  queuedAt = null,
  startedAt = null,
  finishedAt = null,
}: {
  id: string;
  label: string;
  status: WorkflowJobStatus;
  position: number;
  dependencies: string[];
  queuedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}): WorkflowJobGraphNode {
  const overrides: Partial<RunJobDetailDto> = {
    id,
    name: label,
    status,
    position,
    dependencies,
    queued_at: queuedAt,
    started_at: startedAt,
    finished_at: finishedAt,
  };
  const job = workflowJob(overrides);
  return {
    ...job,
    column: 0,
    row: position,
    currentDependencyCount: dependencies.length,
  };
}
