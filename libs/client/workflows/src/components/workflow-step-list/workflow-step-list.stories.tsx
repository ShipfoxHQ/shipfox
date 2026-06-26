import type {RunJobDetailDto, RunStepDetailDto, StepAttemptDto} from '@shipfox/api-workflows-dto';
import {LogView, type LogViewProps} from '@shipfox/client-logs';
import {Text} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import type {WorkflowJob} from '#core/workflow-run.js';
import {workflowJob, workflowStepAttemptDto, workflowStepDto} from '#test/fixtures/workflow-run.js';
import {WorkflowStepList} from './workflow-step-list.js';

const meta = {
  title: 'Workflows/StepList',
  component: WorkflowStepList,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-720 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    job: makeJob({
      steps: [
        makeStep({
          name: 'checkout',
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          name: 'install',
          position: 1,
          status: 'running',
          attempts: [makeAttempt({status: 'running'})],
        }),
        makeStep({name: 'test', position: 2}),
      ],
    }),
  },
} satisfies Meta<typeof WorkflowStepList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllStatuses: Story = {
  args: {
    job: makeJob({
      steps: [
        makeStep({
          name: 'running',
          position: 3,
          status: 'running',
          attempts: [makeAttempt({status: 'running'})],
        }),
        makeStep({
          name: 'succeeded',
          position: 4,
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          name: 'failed',
          position: 5,
          status: 'failed',
          attempts: [makeAttempt({status: 'failed', exit_code: 1})],
        }),
        makeStep({
          name: 'cancelled',
          position: 6,
          status: 'cancelled',
          attempts: [makeAttempt({status: 'cancelled'})],
        }),
        makeStep({
          name: 'timed-out',
          position: 7,
          status: 'timed_out',
          attempts: [makeAttempt({status: 'timed_out'})],
        }),
      ],
    }),
  },
};

export const SetupAndUnnamedSteps: Story = {
  args: {
    job: makeJob({
      steps: [
        makeStep({
          name: 'Set up job',
          type: 'setup',
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          name: null,
          display_name: 'pnpm test --filter=@shipfox/client-workflows',
          position: 1,
          type: 'run',
          config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          name: null,
          display_name:
            'claude-opus-4-8 · Review the failing workflow step tests and propose the smallest fix.',
          position: 2,
          type: 'agent',
          config: {
            model: 'claude-opus-4-8',
            prompt: 'Review the failing workflow step tests and propose the smallest fix.',
          },
          status: 'failed',
          error: {
            message: 'Agent invocation failed',
            category: 'user',
            reason: 'agent_invocation_failed',
          },
          attempts: [makeAttempt({status: 'failed', exit_code: 1})],
        }),
      ],
    }),
  },
};

export const CollapsedAndExpanded: Story = {
  render: () => {
    const build = makeStep({name: 'build', attempts: [makeAttempt()]});
    const deployAttempt = makeAttempt();
    const deploy = makeStep({name: 'deploy', position: 1, attempts: [deployAttempt]});

    return (
      <WorkflowStepList
        job={makeJob({steps: [build, deploy]})}
        defaultSelectedAttemptId={deployAttempt.id}
        renderExpandedStep={({stepId}) => (
          <Text size="sm" className="text-foreground-neutral-subtle">
            Slot content for {stepId}
          </Text>
        )}
      />
    );
  },
};

const activeLogRecords: LogViewProps['records'] = [
  {
    v: 1,
    ts: Date.parse('2026-06-21T12:00:00.000Z'),
    type: 'output',
    stream: 'stdout',
    data: '$ pnpm test --filter=@shipfox/client-workflows\n',
  },
  {
    v: 1,
    ts: Date.parse('2026-06-21T12:00:01.000Z'),
    type: 'output',
    stream: 'stdout',
    data: 'workflow-step-list.test.tsx 18 tests passed\n',
  },
  {
    v: 1,
    ts: Date.parse('2026-06-21T12:00:02.000Z'),
    type: 'output',
    stream: 'stdout',
    data: 'step-attempt-log-panel.test.tsx running smart-tail checks\n',
  },
  {
    v: 1,
    ts: Date.parse('2026-06-21T12:00:03.000Z'),
    type: 'output',
    stream: 'stdout',
    data: 'waiting for live log chunks...\n',
  },
];

export const ActiveExpandedLogs: Story = {
  render: () => {
    const attempt = makeAttempt({status: 'running'});
    const step = makeStep({
      name: 'pnpm test --filter=@shipfox/client-workflows',
      status: 'running',
      attempts: [attempt],
    });

    return (
      <WorkflowStepList
        job={makeJob({steps: [step]})}
        autoSelectActiveAttempt
        renderExpandedStep={() => (
          <LogView records={activeLogRecords} className="max-h-[280px] rounded-8" />
        )}
      />
    );
  },
};

export const FailedStep: Story = {
  args: {
    job: makeJob({
      steps: [
        makeStep({
          name: 'test',
          status: 'failed',
          error: {message: 'Tests failed', category: 'user', reason: 'agent_invocation_failed'},
          attempts: [makeAttempt({status: 'failed', exit_code: 1})],
        }),
      ],
    }),
  },
};

export const CancelledAndPending: Story = {
  args: {
    job: makeJob({
      steps: [
        makeStep({
          name: 'package',
          status: 'cancelled',
          attempts: [makeAttempt({status: 'cancelled'})],
        }),
        makeStep({name: 'deploy', position: 1, status: 'pending'}),
      ],
    }),
  },
};

export const SkippedBeforeStart: Story = {
  args: {
    job: makeJob({status: 'skipped', status_reason: 'dependency_not_completed', steps: []}),
    emptyState: {
      title: 'This job was skipped',
      description: 'A required job did not complete, so this job was skipped.',
      status: 'skipped',
    },
  },
};

export const MultipleAttempts: Story = {
  args: {
    job: makeJob({
      steps: [
        makeStep({
          name: 'release',
          status: 'succeeded',
          current_attempt: 3,
          attempts: [
            makeAttempt({attempt: 1, status: 'failed', exit_code: 1}),
            makeAttempt({attempt: 2, status: 'failed', exit_code: 1, restart_reason: 'retry'}),
            makeAttempt({attempt: 3, status: 'succeeded', restart_reason: 'retry'}),
          ],
        }),
      ],
    }),
  },
};

export const RestartExecutionTimeline: Story = {
  args: {
    job: makeJob({
      name: 'build',
      status: 'succeeded',
      steps: [
        makeStep({
          name: 'checkout',
          position: 0,
          status: 'succeeded',
          attempts: [makeAttempt({attempt: 1, execution_order: 1, status: 'succeeded'})],
        }),
        makeStep({
          name: 'compile',
          position: 1,
          status: 'succeeded',
          current_attempt: 2,
          attempts: [
            makeAttempt({attempt: 1, execution_order: 2, status: 'failed', exit_code: 1}),
            makeAttempt({attempt: 2, execution_order: 4, status: 'succeeded'}),
          ],
        }),
        makeStep({
          name: 'test',
          position: 2,
          status: 'succeeded',
          current_attempt: 2,
          attempts: [
            makeAttempt({attempt: 1, execution_order: 3, status: 'failed', exit_code: 1}),
            makeAttempt({attempt: 2, execution_order: 5, status: 'succeeded'}),
          ],
        }),
        makeStep({
          name: 'package',
          position: 3,
          status: 'succeeded',
          attempts: [makeAttempt({attempt: 1, execution_order: 6, status: 'succeeded'})],
        }),
      ],
    }),
  },
};

export const LongNameWithAttemptChips: Story = {
  decorators: [
    (Story) => (
      <div className="w-440 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    job: makeJob({
      name: 'release-production',
      steps: [
        makeStep({
          name: 'run-production-canary-smoke-tests-with-cross-region-checkout-payment-and-notification-validation',
          status: 'running',
          current_attempt: 4,
          attempts: [
            makeAttempt({attempt: 1, status: 'failed', exit_code: 1}),
            makeAttempt({attempt: 2, status: 'failed', exit_code: 1}),
            makeAttempt({attempt: 3, status: 'succeeded'}),
            makeAttempt({attempt: 4, status: 'running'}),
          ],
        }),
      ],
    }),
  },
};

export const RunningRetryAttempts: Story = {
  args: {
    job: makeJob({
      steps: [
        makeStep({
          name: 'gate',
          status: 'running',
          attempts: [
            makeAttempt({attempt: 1, status: 'failed', exit_code: 1}),
            makeAttempt({attempt: 2, status: 'running', restart_reason: 'manual approval'}),
          ],
        }),
      ],
    }),
  },
};

export const LongContent: Story = {
  decorators: [
    (Story) => (
      <div className="w-360 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    job: makeJob({
      name: 'release-production-multi-region-with-canary-validation-and-post-deploy-observability',
      steps: [
        makeStep({
          name: 'prepare-release-artifacts-for-production-eu-west-and-us-east-regions',
          status: 'succeeded',
          attempts: [makeAttempt({status: 'succeeded'})],
        }),
        makeStep({
          name: 'run-canary-smoke-tests-against-checkout-payment-and-notification-services',
          position: 1,
          status: 'running',
          attempts: [makeAttempt({status: 'running'})],
        }),
        makeStep({
          name: 'publish-observability-summary-with-alert-links-and-rollout-decision',
          position: 2,
          status: 'pending',
        }),
      ],
    }),
  },
};

export const ExpandedSlot: Story = {
  render: () => {
    const attempt = makeAttempt();
    const step = makeStep({name: 'run integration tests', attempts: [attempt]});

    return (
      <WorkflowStepList
        job={makeJob({steps: [step]})}
        defaultSelectedAttemptId={attempt.id}
        renderExpandedStep={({stepId}) => (
          <Text size="sm" className="text-foreground-neutral-subtle">
            Injected detail placeholder for {stepId}
          </Text>
        )}
      />
    );
  },
};

function makeJob(overrides: Partial<RunJobDetailDto> = {}): WorkflowJob {
  return workflowJob(overrides);
}

function makeStep(overrides: Partial<RunStepDetailDto> = {}): RunStepDetailDto {
  return workflowStepDto(overrides);
}

function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  return workflowStepAttemptDto(overrides);
}
