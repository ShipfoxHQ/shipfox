import type {WorkflowRunJobDetailDto} from '@shipfox/api-workflows-dto';
import type {Meta, StoryObj} from '@storybook/react';
import type {KeyboardEventHandler} from 'react';
import type {JobExecutionStatus, JobStatus} from '#core/workflow-run.js';
import {workflowJob, workflowJobExecutionDto} from '#test/fixtures/workflow-run.js';
import type {WorkflowJobGraphNode} from './graph-model.js';
import {WorkflowJobNode} from './workflow-job-node.js';

const statuses: JobStatus[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'];
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
  title: 'Workflows/WorkflowJobNode',
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

export const Playground: Story = {
  render: () => (
    <WorkflowJobNode
      node={makeNode({
        id: 'job-build',
        label: 'build',
        status: 'running',
        position: 0,
        dependencies: [],
      })}
      selected
      onSelect={() => undefined}
      onKeyDown={ignoreKeyDown}
    />
  ),
};

export const Statuses: Story = {
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

export const ListeningProgression: Story = {
  render: () => (
    <div className="grid w-720 grid-cols-2 gap-12">
      <WorkflowJobNode
        node={makeNode({
          id: 'job-one-shot',
          label: 'build',
          status: 'succeeded',
          position: 0,
          dependencies: [],
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <WorkflowJobNode
        node={makeNode({
          id: 'job-listening-pending',
          label: 'no-events-yet',
          mode: 'listening',
          status: 'pending',
          position: 1,
          dependencies: ['build'],
          jobExecutions: [],
          queuedAt: QUEUED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <WorkflowJobNode
        node={makeNode({
          id: 'job-listening-armed',
          label: 'deploy-window',
          mode: 'listening',
          status: 'running',
          listenerStatus: 'listening',
          position: 2,
          dependencies: [],
          jobExecutions: [],
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
        })}
        selected
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <WorkflowJobNode
        node={makeNode({
          id: 'job-one-running-execution',
          label: 'one-running',
          mode: 'listening',
          status: 'running',
          listenerStatus: 'listening',
          position: 3,
          dependencies: [],
          jobExecutions: makeExecutionsByStatus('job-one-running-execution', ['running']),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <WorkflowJobNode
        node={makeNode({
          id: 'job-mixed-executions',
          label: 'mixed-release-gates',
          mode: 'listening',
          status: 'running',
          listenerStatus: 'listening',
          position: 4,
          dependencies: [],
          jobExecutions: makeExecutionsByStatus('job-mixed-executions', [
            'running',
            'running',
            'succeeded',
            'succeeded',
            'succeeded',
            'failed',
          ]),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <WorkflowJobNode
        node={makeNode({
          id: 'job-high-volume-executions',
          label: 'high-volume-events',
          mode: 'listening',
          status: 'running',
          listenerStatus: 'listening',
          position: 5,
          dependencies: [],
          jobExecutions: makeExecutionsFromCounts('job-high-volume-executions', {
            running: 12,
            succeeded: 82,
            failed: 6,
          }),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <WorkflowJobNode
        node={makeNode({
          id: 'job-all-success-executions',
          label: 'all-success',
          mode: 'listening',
          status: 'succeeded',
          listenerStatus: 'resolved',
          position: 6,
          dependencies: [],
          jobExecutions: makeExecutionsByStatus('job-all-success-executions', [
            'succeeded',
            'succeeded',
            'succeeded',
            'succeeded',
          ]),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
          finishedAt: FINISHED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <WorkflowJobNode
        node={makeNode({
          id: 'job-failed-heavy-executions',
          label: 'failed-heavy',
          mode: 'listening',
          status: 'failed',
          listenerStatus: 'resolved',
          position: 7,
          dependencies: [],
          jobExecutions: makeExecutionsFromCounts('job-failed-heavy-executions', {
            running: 1,
            succeeded: 3,
            failed: 8,
          }),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
          finishedAt: FINISHED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
    </div>
  ),
};

function makeNode({
  id,
  label,
  status,
  position,
  dependencies,
  mode = 'one_shot',
  listenerStatus = 'inactive',
  jobExecutions,
  queuedAt = null,
  startedAt = null,
  finishedAt = null,
}: {
  id: string;
  label: string;
  status: JobStatus;
  position: number;
  dependencies: string[];
  mode?: WorkflowRunJobDetailDto['mode'];
  listenerStatus?: WorkflowRunJobDetailDto['listener_status'];
  jobExecutions?: WorkflowRunJobDetailDto['job_executions'];
  queuedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}): WorkflowJobGraphNode {
  const shouldCreateExecution =
    jobExecutions === undefined && (queuedAt !== null || startedAt !== null || finishedAt !== null);
  const overrides: Partial<WorkflowRunJobDetailDto> = {
    id,
    name: label,
    mode,
    status,
    listener_status: listenerStatus,
    position,
    dependencies,
    job_executions: shouldCreateExecution
      ? [
          workflowJobExecutionDto({
            job_id: id,
            status: status === 'skipped' ? 'cancelled' : status,
            queued_at: queuedAt,
            started_at: startedAt,
            finished_at: finishedAt,
          }),
        ]
      : jobExecutions,
  };
  const job = workflowJob(overrides);
  return Object.assign(Object.create(Object.getPrototypeOf(job)), job, {
    column: 0,
    row: position,
    currentDependencyCount: dependencies.length,
  });
}

function makeExecutionsFromCounts(
  jobId: string,
  counts: Partial<Record<'running' | 'succeeded' | 'failed', number>>,
): WorkflowRunJobDetailDto['job_executions'] {
  return makeExecutionsByStatus(jobId, [
    ...Array.from<JobExecutionStatus>({length: counts.running ?? 0}).fill('running'),
    ...Array.from<JobExecutionStatus>({length: counts.succeeded ?? 0}).fill('succeeded'),
    ...Array.from<JobExecutionStatus>({length: counts.failed ?? 0}).fill('failed'),
  ]);
}

function makeExecutionsByStatus(
  jobId: string,
  statuses: readonly JobExecutionStatus[],
): WorkflowRunJobDetailDto['job_executions'] {
  return statuses.map((status, index) => ({
    id: `exec-${index + 1}`,
    job_id: jobId,
    sequence: index + 1,
    name: `execution-${index + 1}`,
    status,
    status_reason: status === 'failed' ? 'step_failed' : null,
    queued_at: '2026-06-26T11:54:00.000Z',
    started_at: '2026-06-26T11:57:46.000Z',
    finished_at: status === 'running' ? null : '2026-06-26T12:00:00.000Z',
    timed_out_at: null,
    created_at: '2026-06-26T11:54:00.000Z',
    updated_at: '2026-06-26T12:00:00.000Z',
    steps: [],
  }));
}
