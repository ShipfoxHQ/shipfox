import type {
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {Badge, Code, Text} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import {useState} from 'react';
import type {Job} from '#core/workflow-run.js';
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

export const RegularJobVariants: Story = {
  decorators: [
    (Story) => (
      <div className="w-760 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="flex flex-col gap-16">
      <StoryLabel title="Single execution" description="No execution selector needed." />
      <JobCardStory job={singleExecutionJob()} />
      <StoryLabel title="Display name fallback" description="The YAML key remains visible." />
      <JobCardStory job={keyFallbackJob()} />
      <StoryLabel
        title="Retry history"
        description="Execution selection appears only when useful."
      />
      <JobCardStory job={failedThenSucceededJob()} initialJobExecutionId="exec-2" />
    </div>
  ),
};

export const ListeningJobControlSurfaces: Story = {
  decorators: [
    (Story) => (
      <div className="w-[980px] bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="grid grid-cols-2 gap-16">
      <ListeningJobCardPreview
        title="release-gates"
        status="listening"
        statusVariant="info"
        waitingFor="workflow.gate.open"
        stopCondition="workflow.gate.close"
        executionSummary="23 executions"
        latestExecution="#23 running"
        density="compact"
      />
      <ListeningJobCardPreview
        title="deploy-window"
        status="resolved"
        statusVariant="neutral"
        waitingFor="deploy.requested"
        stopCondition="max executions reached"
        executionSummary="100 executions"
        latestExecution="#100 succeeded"
        density="history"
      />
    </div>
  ),
};

export const ListeningJobHighVolumeHistory: Story = {
  decorators: [
    (Story) => (
      <div className="w-[760px] bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <ListeningJobCardPreview
      title="release-production-gates"
      status="listening"
      statusVariant="info"
      waitingFor="github.deployment_status"
      stopCondition="slack.approval.received or 30m timeout"
      executionSummary="124 executions"
      latestExecution="#124 failed"
      density="history"
    />
  ),
};

function JobCardStory({
  job,
  initialJobExecutionId,
}: {
  job: Job;
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

function StoryLabel({title, description}: {title: string; description: string}) {
  return (
    <div className="flex items-baseline gap-8">
      <Text size="xs" bold className="text-foreground-neutral-base">
        {title}
      </Text>
      <Text size="xs" className="text-foreground-neutral-muted">
        {description}
      </Text>
    </div>
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

function ListeningJobCardPreview({
  title,
  status,
  statusVariant,
  waitingFor,
  stopCondition,
  executionSummary,
  latestExecution,
  density,
}: {
  title: string;
  status: string;
  statusVariant: 'info' | 'neutral';
  waitingFor: string;
  stopCondition: string;
  executionSummary: string;
  latestExecution: string;
  density: 'compact' | 'history';
}) {
  const executions = [
    {id: '#124', status: 'failed', received: '14:42:18', trigger: 'github.deployment_status'},
    {id: '#123', status: 'succeeded', received: '14:39:02', trigger: 'github.deployment_status'},
    {id: '#122', status: 'succeeded', received: '14:36:11', trigger: 'github.deployment_status'},
    {id: '#121', status: 'cancelled', received: '14:33:48', trigger: 'slack.approval.received'},
  ];

  return (
    <section className="flex min-h-0 flex-col rounded-8 border border-border-neutral-base bg-background-components-base">
      <div className="flex flex-col gap-10 border-b border-border-neutral-base px-16 py-12">
        <div className="flex min-w-0 items-center justify-between gap-12">
          <div className="flex min-w-0 items-center gap-8">
            <span className="size-8 shrink-0 rounded-full bg-background-accent-blue-base" />
            <Code variant="label" bold className="min-w-0 truncate text-foreground-neutral-base">
              {title}
            </Code>
          </div>
          <Badge variant={statusVariant} size="2xs" className="font-code">
            {status}
          </Badge>
        </div>
        <div className="grid gap-8 md:grid-cols-3">
          <ListeningMetric label="Waiting for" value={waitingFor} />
          <ListeningMetric label="Stops when" value={stopCondition} />
          <ListeningMetric label="Executions" value={executionSummary} />
        </div>
      </div>
      <div className="flex flex-col gap-10 px-16 py-12">
        <div className="flex items-center justify-between gap-12">
          <Text size="xs" bold className="text-foreground-neutral-base">
            Latest execution
          </Text>
          <Badge variant="neutral" size="2xs" className="font-code">
            {latestExecution}
          </Badge>
        </div>
        {density === 'compact' ? (
          <div className="rounded-6 border border-border-neutral-base bg-background-neutral-base px-12 py-10">
            <Text size="xs" className="font-code text-foreground-neutral-muted">
              Received github.deployment_status at 14:42:18
            </Text>
            <Text size="sm" className="text-foreground-neutral-subtle">
              Deployment status accepted; waiting for approval signal.
            </Text>
          </div>
        ) : (
          <div className="overflow-hidden rounded-6 border border-border-neutral-base">
            {executions.map((execution) => (
              <div
                key={execution.id}
                className="grid grid-cols-[64px_88px_1fr_64px] items-center gap-8 border-b border-border-neutral-base px-10 py-7 last:border-b-0"
              >
                <Code variant="label" className="text-foreground-neutral-base">
                  {execution.id}
                </Code>
                <Badge
                  variant={execution.status === 'failed' ? 'error' : 'neutral'}
                  size="2xs"
                  className="font-code"
                >
                  {execution.status}
                </Badge>
                <Text size="xs" className="truncate font-code text-foreground-neutral-muted">
                  {execution.trigger}
                </Text>
                <Text size="xs" className="text-right font-code text-foreground-neutral-muted">
                  {execution.received}
                </Text>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ListeningMetric({label, value}: {label: string; value: string}) {
  return (
    <div className="min-w-0 rounded-6 border border-border-neutral-base bg-background-neutral-base px-10 py-8">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Text size="xs" className="truncate font-code text-foreground-neutral-base">
        {value}
      </Text>
    </div>
  );
}

function singleExecutionJob(): Job {
  return makeJob({
    id: 'job-build',
    name: 'build',
    status: 'succeeded',
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

function keyFallbackJob(): Job {
  return makeJob({
    id: 'job-key-fallback',
    key: 'release-production',
    name: null,
    status: 'running',
    job_executions: [
      makeExecution({
        id: 'exec-key-fallback',
        job_id: 'job-key-fallback',
        sequence: 1,
        status: 'running',
        started_at: '2026-06-21T12:00:00.000Z',
        steps: [
          makeStep('package', 'succeeded', 0, 'exec-key-fallback'),
          makeStep('deploy', 'running', 1, 'exec-key-fallback'),
        ],
      }),
    ],
  });
}

function failedThenSucceededJob(): Job {
  return makeJob({
    id: 'job-deploy',
    name: 'deploy',
    status: 'succeeded',
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

function runningRetryJob(): Job {
  return makeJob({
    id: 'job-release',
    name: 'release-production',
    status: 'running',
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

function zeroExecutionJob(): Job {
  return makeJob({
    id: 'job-skipped',
    name: 'deploy-preview',
    status: 'skipped',
    status_reason: 'dependency_not_completed',
    dependencies: ['build'],
    job_executions: [],
  });
}

function carriedOverJob(): Job {
  return makeJob({
    id: 'job-test',
    name: 'test',
    status: 'succeeded',
    carried_over: true,
    job_executions: [],
  });
}

function longNameManyExecutionsJob(): Job {
  return makeJob({
    id: 'job-long',
    name: 'release-production-multi-region-with-canary-validation-and-post-deploy-observability',
    status: 'running',
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

function makeJob(overrides: Partial<WorkflowRunJobDetailDto>): Job {
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
