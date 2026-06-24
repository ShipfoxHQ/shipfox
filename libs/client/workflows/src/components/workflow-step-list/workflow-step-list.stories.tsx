import type {RunJobDetailDto, RunStepDetailDto, StepAttemptDto} from '@shipfox/api-workflows-dto';
import {Text} from '@shipfox/react-ui';
import type {Meta, StoryObj} from '@storybook/react';
import {WorkflowStepList} from './workflow-step-list.js';

let jobSequence = 0;
let stepSequence = 0;
let attemptSequence = 0;

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
        defaultSelectedStepId={deployAttempt.id}
        renderExpandedStep={({stepId}) => (
          <Text size="sm" className="text-foreground-neutral-subtle">
            Slot content for {stepId}
          </Text>
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
        defaultSelectedStepId={attempt.id}
        renderExpandedStep={({stepId}) => (
          <Text size="sm" className="text-foreground-neutral-subtle">
            Injected detail placeholder for {stepId}
          </Text>
        )}
      />
    );
  },
};

function makeJob(overrides: Partial<RunJobDetailDto> = {}): RunJobDetailDto {
  jobSequence += 1;
  return {
    id: `44444444-4444-4444-8444-${String(jobSequence).padStart(12, '0')}`,
    run_id: '11111111-1111-4111-8111-111111111111',
    name: 'build',
    status: 'pending',
    dependencies: [],
    position: 0,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    queued_at: null,
    started_at: null,
    finished_at: null,
    steps: [],
    ...overrides,
  };
}

function makeStep(overrides: Partial<RunStepDetailDto> = {}): RunStepDetailDto {
  stepSequence += 1;
  const displayName =
    overrides.display_name ??
    (typeof overrides.name === 'string' && overrides.name.trim() ? overrides.name : 'build');
  return {
    id: `55555555-5555-4555-8555-${String(stepSequence).padStart(12, '0')}`,
    job_id: '44444444-4444-4444-8444-000000000001',
    name: 'build',
    display_name: displayName,
    status: 'pending',
    type: 'run',
    config: {},
    error: null,
    position: 0,
    current_attempt: 1,
    created_at: '2026-06-21T12:00:00.000Z',
    updated_at: '2026-06-21T12:01:00.000Z',
    attempts: [],
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<StepAttemptDto> = {}): StepAttemptDto {
  attemptSequence += 1;
  return {
    id: `66666666-6666-4666-8666-${String(attemptSequence).padStart(12, '0')}`,
    step_id: '55555555-5555-4555-8555-000000000001',
    job_id: '44444444-4444-4444-8444-000000000001',
    attempt: 1,
    execution_order: attemptSequence,
    status: 'pending',
    exit_code: null,
    output: null,
    error: null,
    gate_result: null,
    restart_reason: null,
    restart_result: null,
    started_at: '2026-06-21T12:00:00.000Z',
    finished_at: null,
    ...overrides,
  };
}
