import type {
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {Text} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import type {WorkflowJob} from '#core/workflow-run.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import type {WorkflowStepExpandedContext} from '../workflow-step-list/index.js';
import {resolveJobExecution} from './workflow-run-selection.js';
import {WorkflowRunJobCard} from './workflow-run-view.js';

const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';

const meta = {
  title: 'Workflows/RunJobCard',
  component: WorkflowRunJobCard,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-760 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    workspaceId: WORKSPACE_ID,
    job: singleExecutionJob(),
    selectedJobExecution: singleExecutionJob().jobExecutions[0],
    selectedAttemptId: null,
    onSelectedJobExecutionChange: undefined,
    onSelectedAttemptChange: undefined,
    renderExpandedStep: StepDetailPlaceholder,
  },
} satisfies Meta<typeof WorkflowRunJobCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleExecution: Story = {
  render: () => <JobCardStory job={singleExecutionJob()} />,
};

export const FailedThenSucceeded: Story = {
  render: () => <JobCardStory job={failedThenSucceededJob()} initialJobExecutionId="exec-2" />,
};

export const RunningRetry: Story = {
  render: () => <JobCardStory job={runningRetryJob()} initialJobExecutionId="exec-2" />,
};

export const TerminalZeroExecution: Story = {
  render: () => <JobCardStory job={zeroExecutionJob()} />,
};

export const CarriedOver: Story = {
  render: () => <JobCardStory job={carriedOverJob()} />,
};

export const LongNameWrappedChips: Story = {
  decorators: [
    (Story) => (
      <div className="w-440 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  render: () => <JobCardStory job={longNameManyExecutionsJob()} initialJobExecutionId="exec-6" />,
};

function JobCardStory({
  job,
  initialJobExecutionId,
}: {
  job: WorkflowJob;
  initialJobExecutionId?: string | undefined;
}) {
  const [selectedJobExecutionId, setSelectedJobExecutionId] = useState(initialJobExecutionId);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  const selectedJobExecution = resolveJobExecution(job, selectedJobExecutionId);

  function selectJobExecution(jobExecutionId: string | undefined) {
    setSelectedJobExecutionId(jobExecutionId);
    setSelectedAttemptId(null);
  }

  return (
    <WorkflowRunJobCard
      workspaceId={WORKSPACE_ID}
      job={job}
      selectedJobExecution={selectedJobExecution}
      selectedAttemptId={selectedAttemptId}
      onSelectedJobExecutionChange={selectJobExecution}
      onSelectedAttemptChange={(attemptId) => setSelectedAttemptId(attemptId ?? null)}
      renderExpandedStep={StepDetailPlaceholder}
    />
  );
}

function StepDetailPlaceholder({attempt, attemptStatus}: WorkflowStepExpandedContext) {
  return (
    <div className="rounded-6 border border-border-neutral-base bg-background-components-base px-12 py-10">
      <Text size="xs" className="font-code text-foreground-neutral-muted">
        attempt #{attempt} - {attemptStatus}
      </Text>
      <Text size="sm" className="text-foreground-neutral-subtle">
        Step detail content renders here in the run viewer.
      </Text>
    </div>
  );
}

function singleExecutionJob(): WorkflowJob {
  return makeJob({
    id: 'job-build',
    name: 'build',
    status: 'succeeded',
    started_at: '2026-06-21T12:00:00.000Z',
    finished_at: '2026-06-21T12:03:00.000Z',
    job_executions: [
      makeExecution({
        id: 'exec-1',
        job_id: 'job-build',
        sequence: 1,
        status: 'succeeded',
        started_at: '2026-06-21T12:00:00.000Z',
        finished_at: '2026-06-21T12:03:00.000Z',
        steps: [
          makeStep('checkout', 'succeeded', 0, 'exec-1'),
          makeStep('install', 'succeeded', 1, 'exec-1'),
          makeStep('test', 'succeeded', 2, 'exec-1'),
        ],
      }),
    ],
  });
}

function failedThenSucceededJob(): WorkflowJob {
  return makeJob({
    id: 'job-deploy',
    name: 'deploy',
    status: 'succeeded',
    started_at: '2026-06-21T12:00:00.000Z',
    finished_at: '2026-06-21T12:08:30.000Z',
    job_executions: [
      makeExecution({
        id: 'exec-1',
        job_id: 'job-deploy',
        sequence: 1,
        status: 'failed',
        status_reason: 'step_failed',
        started_at: '2026-06-21T12:00:00.000Z',
        finished_at: '2026-06-21T12:02:30.000Z',
        steps: [
          makeStep('deploy', 'failed', 0, 'exec-1', {
            attempts: [
              workflowStepAttemptDto({
                id: 'attempt-deploy-1',
                step_id: 'step-deploy-1',
                status: 'failed',
                exit_code: 1,
                error: {message: 'Deployment failed'},
              }),
            ],
          }),
        ],
      }),
      makeExecution({
        id: 'exec-2',
        job_id: 'job-deploy',
        sequence: 2,
        status: 'succeeded',
        started_at: '2026-06-21T12:06:00.000Z',
        finished_at: '2026-06-21T12:08:30.000Z',
        steps: [
          makeStep('deploy', 'succeeded', 0, 'exec-2'),
          makeStep('smoke-test', 'succeeded', 1, 'exec-2'),
        ],
      }),
    ],
  });
}

function runningRetryJob(): WorkflowJob {
  return makeJob({
    id: 'job-release',
    name: 'release-production',
    status: 'running',
    started_at: '2026-06-21T12:00:00.000Z',
    job_executions: [
      makeExecution({
        id: 'exec-1',
        job_id: 'job-release',
        sequence: 1,
        status: 'failed',
        status_reason: 'step_failed',
        started_at: '2026-06-21T12:00:00.000Z',
        finished_at: '2026-06-21T12:04:00.000Z',
        steps: [makeStep('package', 'failed', 0, 'exec-1')],
      }),
      makeExecution({
        id: 'exec-2',
        job_id: 'job-release',
        sequence: 2,
        status: 'running',
        started_at: '2026-06-21T12:06:00.000Z',
        steps: [
          makeStep('package', 'succeeded', 0, 'exec-2'),
          makeStep('publish', 'running', 1, 'exec-2', {
            current_attempt: 1,
            attempts: [
              workflowStepAttemptDto({
                id: 'attempt-publish-running',
                step_id: 'step-publish-exec-2',
                status: 'running',
                exit_code: null,
                finished_at: null,
              }),
            ],
          }),
          makeStep('notify', 'pending', 2, 'exec-2', {attempts: []}),
        ],
      }),
    ],
  });
}

function zeroExecutionJob(): WorkflowJob {
  return makeJob({
    id: 'job-skipped',
    name: 'deploy-preview',
    status: 'skipped',
    status_reason: 'dependency_not_completed',
    dependencies: ['build'],
    job_executions: [],
  });
}

function carriedOverJob(): WorkflowJob {
  return makeJob({
    id: 'job-test',
    name: 'test',
    status: 'succeeded',
    carried_over: true,
    job_executions: [],
  });
}

function longNameManyExecutionsJob(): WorkflowJob {
  return makeJob({
    id: 'job-long',
    name: 'release-production-multi-region-with-canary-validation-and-post-deploy-observability',
    status: 'running',
    started_at: '2026-06-21T12:00:00.000Z',
    job_executions: Array.from({length: 6}, (_, index) => {
      const sequence = index + 1;
      const status: WorkflowRunJobExecutionDetailDto['status'] =
        sequence < 6 ? 'failed' : 'running';
      return makeExecution({
        id: `exec-${sequence}`,
        job_id: 'job-long',
        sequence,
        status,
        status_reason: status === 'failed' ? 'step_failed' : null,
        started_at: `2026-06-21T12:${String(index * 3).padStart(2, '0')}:00.000Z`,
        finished_at:
          status === 'failed'
            ? `2026-06-21T12:${String(index * 3 + 2).padStart(2, '0')}:00.000Z`
            : null,
        steps: [
          makeStep(
            'run-production-canary-smoke-tests-with-cross-region-checkout-payment-and-notification-validation',
            status,
            0,
            `exec-${sequence}`,
          ),
        ],
      });
    }),
  });
}

function makeJob(overrides: Partial<WorkflowRunJobDetailDto> & {name: string}): WorkflowJob {
  return workflowJob(overrides);
}

function makeExecution(
  overrides: Partial<WorkflowRunJobExecutionDetailDto> & {
    id: string;
    job_id: string;
    sequence: number;
  },
): WorkflowRunJobExecutionDetailDto {
  return workflowJobExecutionDto(overrides);
}

function makeStep(
  name: string,
  status: string,
  position: number,
  jobExecutionId: string,
  overrides: Partial<WorkflowRunStepDetailDto> = {},
): WorkflowRunStepDetailDto {
  const stepId = `step-${name}-${jobExecutionId}`;
  return workflowStepDto({
    id: stepId,
    job_execution_id: jobExecutionId,
    name,
    display_name: name,
    position,
    status,
    attempts:
      overrides.attempts ??
      (status === 'pending'
        ? []
        : [
            workflowStepAttemptDto({
              id: `attempt-${name}-${jobExecutionId}`,
              step_id: stepId,
              status,
              exit_code: status === 'failed' ? 1 : null,
              finished_at: status === 'running' ? null : '2026-06-21T12:01:00.000Z',
            }),
          ]),
    ...overrides,
  });
}
