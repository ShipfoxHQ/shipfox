import type {RunDetailResponseDto, RunJobDetailDto} from '@shipfox/api-workflows-dto';
import type {Meta, StoryObj} from '@storybook/react';
import {within} from 'storybook/test';
import {WorkflowJobsGraph} from './workflow-jobs-graph.js';

let jobSequence = 0;

const meta = {
  title: 'Workflows/JobsGraph',
  component: WorkflowJobsGraph,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="h-520 w-900 overflow-auto bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    className: 'h-full',
  },
} satisfies Meta<typeof WorkflowJobsGraph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleJob: Story = {
  args: {run: makeRun({jobs: [makeJob({name: 'build'})]})},
};

export const LinearTenJobs: Story = {
  args: {run: makeRun({jobs: linearJobs(10)})},
};

export const ParallelTenJobs: Story = {
  args: {
    run: makeRun({
      jobs: Array.from({length: 10}, (_, index) =>
        makeJob({name: `job-${String(index + 1).padStart(2, '0')}`, position: index}),
      ),
    }),
  },
};

export const BranchAndJoin: Story = {
  args: {
    run: makeRun({
      jobs: [
        makeJob({name: 'build', position: 0, status: 'succeeded'}),
        makeJob({name: 'lint', position: 1, dependencies: ['build'], status: 'succeeded'}),
        makeJob({name: 'test', position: 2, dependencies: ['build'], status: 'running'}),
        makeJob({name: 'deploy', position: 3, dependencies: ['lint', 'test']}),
      ],
    }),
  },
};

export const TwoRunningJobs: Story = {
  args: {
    run: makeRun({
      jobs: [
        makeJob({name: 'linux', position: 0, status: 'running'}),
        makeJob({name: 'macos', position: 1, status: 'running'}),
      ],
    }),
  },
};

export const FailedDependencyCancelsDownstream: Story = {
  args: {
    run: makeRun({
      jobs: [
        makeJob({name: 'build', status: 'failed'}),
        makeJob({
          name: 'deploy',
          position: 1,
          dependencies: ['build'],
          status: 'cancelled',
        }),
      ],
    }),
  },
};

export const Empty: Story = {
  args: {run: makeRun({jobs: []})},
};

export const Selected: Story = {
  args: {
    run: makeRun({
      jobs: [
        makeJob({name: 'build', status: 'succeeded'}),
        makeJob({name: 'deploy', position: 1, dependencies: ['build'], status: 'running'}),
      ],
    }),
  },
  play: async ({canvasElement}) => {
    await within(canvasElement)
      .getByRole('button', {
        name: 'deploy, Running, Depends on build',
      })
      .click();
  },
};

export const LargeWideAndTall: Story = {
  args: {
    run: makeRun({
      jobs: [
        ...linearJobs(10),
        ...Array.from({length: 10}, (_, index) =>
          makeJob({
            name: `parallel-${String(index + 1).padStart(2, '0')}`,
            position: 20 + index,
            status: index < 2 ? 'running' : 'pending',
          }),
        ),
      ],
    }),
  },
};

function linearJobs(count: number): RunJobDetailDto[] {
  return Array.from({length: count}, (_, index) =>
    makeJob({
      name: `job-${String(index + 1).padStart(2, '0')}`,
      position: index,
      dependencies: index === 0 ? [] : [`job-${String(index).padStart(2, '0')}`],
      status: index < count - 1 ? 'succeeded' : 'running',
    }),
  );
}

function makeRun(overrides: Partial<RunDetailResponseDto> = {}): RunDetailResponseDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    project_id: '22222222-2222-4222-8222-222222222222',
    definition_id: '33333333-3333-4333-8333-333333333333',
    name: 'Deploy',
    status: 'running',
    trigger_source: 'manual',
    trigger_event: 'fire',
    trigger_payload: {},
    inputs: null,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    jobs: [],
    ...overrides,
  };
}

function makeJob(overrides: Partial<RunJobDetailDto> & {name: string}): RunJobDetailDto {
  jobSequence += 1;
  const {name, ...rest} = overrides;
  return {
    id: `44444444-4444-4444-8444-${String(jobSequence).padStart(12, '0')}`,
    run_id: '11111111-1111-4111-8111-111111111111',
    name,
    status: 'pending',
    dependencies: [],
    position: jobSequence,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    steps: [],
    ...rest,
  };
}
