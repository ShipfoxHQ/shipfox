import type {StepAttemptDto} from '@shipfox/api-workflows-dto';
import {stepLogsQueryKeys} from '@shipfox/client-logs';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useState} from 'react';
import type {JobStatusReason, StepAttemptDetail} from '#core/workflow-run.js';
import {stepAttemptDetailQueryKeys} from '#hooks/api/step-attempt-detail.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {buildStepListModel, type StepListEntryModel} from '../step-list/step-list-model.js';
import {StepInspectorSheet} from './step-troubleshooting.js';

type ToolStepOutcome = 'succeeded' | 'failed' | 'running';

interface StepInspectorStoryArgs {
  toolOutcome: ToolStepOutcome;
  runnerLossReason: RunnerLossReason;
}

type RunnerLossReason = Extract<
  JobStatusReason,
  'lease_expired' | 'provider_lost' | 'lifecycle_violation' | 'runner_lost'
>;

const RUNNER_LOSS_REASONS: readonly RunnerLossReason[] = [
  'lease_expired',
  'provider_lost',
  'lifecycle_violation',
  'runner_lost',
];

const meta = {
  title: 'Workflows/StepInspector',
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    toolOutcome: 'succeeded',
    runnerLossReason: 'lease_expired',
  },
  argTypes: {
    toolOutcome: {control: 'select', options: ['succeeded', 'failed', 'running']},
    runnerLossReason: {control: 'select', options: RUNNER_LOSS_REASONS},
  },
} satisfies Meta<StepInspectorStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FailedStep: Story = {
  render: () => <FailedStepStory />,
};

export const GateAttemptLimitReached: Story = {
  render: () => <GateAttemptLimitReachedStory />,
};

export const ProviderInterrupted: Story = {
  render: () => <ProviderInterruptedStory />,
};

export const RunnerLossCauses: Story = {
  render: ({runnerLossReason}) => <RunnerLossStory reason={runnerLossReason} />,
};

export const ToolStep: Story = {
  render: ({toolOutcome}) => <ToolStepStory outcome={toolOutcome} />,
};

const ACTION_STATES = [
  'succeeded',
  'input_invalid',
  'unavailable',
  'early_exit',
  'out_of_memory',
  'output_invalid',
  'output_too_large',
] as const;
type ActionState = (typeof ACTION_STATES)[number];

const ACTION_ERRORS: Record<Exclude<ActionState, 'succeeded'>, Record<string, unknown>> = {
  input_invalid: {
    reason: 'action_input_invalid',
    field: 'action.with.thread_ts',
    message: 'Action input "thread_ts" is required.',
  },
  unavailable: {
    reason: 'action_unavailable',
    message: 'The action snapshot did not match digest sha256:0123456789ab.',
  },
  early_exit: {message: 'The action exited before it finished.', exit_code: 0},
  out_of_memory: {
    message: 'The action was killed (SIGKILL). It likely ran out of memory.',
    signal: 'SIGKILL',
  },
  output_invalid: {
    reason: 'output_invalid',
    field: 'outputs.message_count',
    message: 'Output "message_count" must be a number.',
  },
  output_too_large: {
    reason: 'step_result_too_large',
    message: 'Output "markdown" exceeds the per-value size limit of 65536 bytes.',
  },
};

/** Action identity, masked inputs, bindings and grants. */
export const ActionStep: Story = {
  render: () => <ActionStepStory state="succeeded" />,
};

/** Each action failure callout: invalid input, unavailable code, early exit, memory, outputs. */
export const ActionStepFailed: StoryObj<{actionState: Exclude<ActionState, 'succeeded'>}> = {
  args: {actionState: 'out_of_memory'},
  argTypes: {actionState: {control: 'select', options: ACTION_STATES.slice(1)}},
  render: ({actionState}) => <ActionStepStory key={actionState} state={actionState} />,
};

function ActionStepStory({state}: {state: ActionState}) {
  const entry = actionStepEntry(state);
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}},
    });
    client.setQueryData(
      stepAttemptDetailQueryKeys.detail(entry.step.id, entry.attempt),
      actionStepDetail(entry.step.id),
    );
    client.setQueryData(stepLogsQueryKeys.detail(entry.step.id, entry.attempt), {
      records: [
        {
          v: 1,
          ts: Date.parse('2026-09-27T12:00:00.000Z'),
          type: 'output',
          stream: 'stdout',
          data: 'Shipfox action Slack thread to Markdown sha256:0123456789ab · node v24.3.0 · @shipfox/actions 0.4.1\n',
        },
      ],
      nextCursor: 1,
      source: 'inline',
      state: 'closed',
      complete: true,
      hasMore: false,
      truncated: false,
      totalBytes: null,
      expiresAt: null,
    });
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background-neutral-base p-16">
        <StepInspectorSheet
          entry={entry}
          open
          onOpenChange={() => undefined}
          workspaceSlug="acme"
          projectSlug="platform"
          workflowRunId="11111111-1111-4111-8111-111111111111"
          runAttempt={1}
          jobId="44444444-4444-4444-8444-000000000005"
          onViewLogs={() => undefined}
        />
      </main>
    </QueryClientProvider>
  );
}

function actionStepEntry(state: ActionState): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-000000000005';
  const executionId = '77777777-7777-4777-8777-000000000005';
  const stepId = '55555555-5555-4555-8555-000000000005';
  const status = state === 'succeeded' ? 'succeeded' : 'failed';
  const error = state === 'succeeded' ? null : ACTION_ERRORS[state];
  const job = workflowJob({
    id: jobId,
    name: 'investigate',
    key: 'investigate',
    status,
    job_executions: [
      workflowJobExecutionDto({
        id: executionId,
        job_id: jobId,
        status,
        steps: [
          workflowStepDto({
            id: stepId,
            job_execution_id: executionId,
            name: 'Save the Slack thread',
            key: 'thread',
            status,
            type: 'action',
            source_location: {start_line: 12, end_line: 18},
            error,
            attempts: [
              workflowStepAttemptDto({
                id: '66666666-6666-4666-8666-000000000005',
                step_id: stepId,
                status,
                outputs:
                  state === 'succeeded'
                    ? {path: 'context/slack-thread.md', message_count: 42, complete: true}
                    : null,
                error,
                finished_at: '2026-09-27T12:01:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Story fixture is missing a job execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Story fixture is missing a step attempt.');
  return entry;
}

function actionStepDetail(stepId: string): StepAttemptDetail {
  return {
    stepId,
    attempt: 1,
    session: null,
    authoredConfig: null,
    config: {
      action: {
        uses: './.shipfox/actions/slack-thread',
        digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        main: 'index.ts',
        name: 'Slack thread to Markdown',
      },
      inputs: {
        channel_id: 'C0123456',
        thread_ts: '1727000000.1234',
        destination: 'context/slack-thread.md',
      },
      secret_bindings: [
        {target: {kind: 'input', name: 'token'}, segments: [{kind: 'secret', key: 'SLACK_TOKEN'}]},
      ],
      integrations: [
        {
          alias: 'slack',
          provider: 'slack',
          connection_slug: 'team-slack',
          tools: [
            {id: 'read_thread', sensitivity: 'read', result: 'json'},
            {id: 'read_user_profile', sensitivity: 'read', result: 'json'},
            {id: 'post_message', sensitivity: 'write', result: 'json'},
          ],
        },
      ],
    },
    toolArguments: null,
    evaluationTrace: null,
  };
}

function ProviderInterruptedStory() {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}}}),
  );
  const entry = failedStepEntry();
  const error = {
    ...entry.step.error,
    message: 'Stream error occurred',
    code: 'provider_stream_interrupted',
    category: 'provider' as const,
    managedProviderId: 'shipfox',
    retryable: true,
    attemptCount: 4,
    maxAttempts: 4,
  };
  entry.step.error = error;
  entry.error = error;

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background-neutral-base p-16">
        <StepInspectorSheet
          entry={entry}
          open
          onOpenChange={() => undefined}
          workspaceSlug="acme"
          projectSlug="platform"
          workflowRunId="11111111-1111-4111-8111-111111111111"
          runAttempt={1}
          jobId="44444444-4444-4444-8444-000000000001"
        />
      </main>
    </QueryClientProvider>
  );
}

function RunnerLossStory({reason}: {reason: RunnerLossReason}) {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}}}),
  );
  const entry = runnerLossEntry(reason);

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background-neutral-base p-16">
        <StepInspectorSheet
          entry={entry}
          jobStatusReason={reason}
          open
          onOpenChange={() => undefined}
          workspaceSlug="acme"
          projectSlug="platform"
          workflowRunId="11111111-1111-4111-8111-111111111111"
          runAttempt={1}
          jobId="44444444-4444-4444-8444-000000000004"
        />
      </main>
    </QueryClientProvider>
  );
}

function GateAttemptLimitReachedStory() {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}}}),
  );
  const entry = gateAttemptLimitEntry();

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background-neutral-base p-16">
        <StepInspectorSheet
          entry={entry}
          open
          onOpenChange={() => undefined}
          workspaceSlug="acme"
          projectSlug="platform"
          workflowRunId="11111111-1111-4111-8111-111111111111"
          runAttempt={1}
          jobId="44444444-4444-4444-8444-000000000003"
        />
      </main>
    </QueryClientProvider>
  );
}

function ToolStepStory({outcome}: {outcome: ToolStepOutcome}) {
  const entry = toolStepEntry(outcome);
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}},
    });
    client.setQueryData(
      stepAttemptDetailQueryKeys.detail(entry.step.id, entry.attempt),
      toolStepDetail(entry.step.id),
    );
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background-neutral-base p-16">
        <StepInspectorSheet
          entry={entry}
          open
          onOpenChange={() => undefined}
          workspaceSlug="acme"
          projectSlug="platform"
          workflowRunId="11111111-1111-4111-8111-111111111111"
          runAttempt={1}
          jobId="44444444-4444-4444-8444-000000000002"
          onViewLogs={() => undefined}
        />
      </main>
    </QueryClientProvider>
  );
}

function FailedStepStory() {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}}}),
  );
  const entry = failedStepEntry();

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background-neutral-base p-16">
        <StepInspectorSheet
          entry={entry}
          open
          onOpenChange={() => undefined}
          workspaceSlug="acme"
          projectSlug="platform"
          workflowRunId="11111111-1111-4111-8111-111111111111"
          runAttempt={1}
          jobId="44444444-4444-4444-8444-000000000001"
        />
      </main>
    </QueryClientProvider>
  );
}

function failedStepEntry(): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-000000000001';
  const executionId = '77777777-7777-4777-8777-000000000001';
  const stepId = '55555555-5555-4555-8555-000000000001';
  const attemptId = '66666666-6666-4666-8666-000000000001';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'failed',
    job_executions: [
      workflowJobExecutionDto({
        id: executionId,
        job_id: jobId,
        status: 'failed',
        steps: [
          workflowStepDto({
            id: stepId,
            job_execution_id: executionId,
            name: 'Run verification suite',
            key: 'run-verification',
            status: 'failed',
            status_reason: 'agent_invocation_failed',
            config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
            evaluation_trace: [
              {
                expression: 'inputs["branch"]',
                roots: ['inputs'],
                fill_target: 'step-dispatch',
                evaluated_at: '2026-06-21T12:04:00.000Z',
                field: 'branch',
                value: 'main',
              },
            ],
            error: {
              message: 'The verification agent returned a non-zero exit code.',
              reason: 'agent_invocation_failed',
              category: 'user',
              exit_code: 1,
            },
            attempts: [
              workflowStepAttemptDto({
                id: attemptId,
                step_id: stepId,
                status: 'failed',
                exit_code: 1,
                output: {summary: 'Tests failed before the report was uploaded.'},
                outputs: {failed_tests: 3},
                error: {
                  message: 'The verification agent returned a non-zero exit code.',
                  reason: 'agent_invocation_failed',
                  category: 'user',
                  exit_code: 1,
                },
                finished_at: '2026-06-21T12:04:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Story fixture is missing a job execution.');

  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Story fixture is missing a step attempt.');

  return entry;
}

function gateAttemptLimitEntry(): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-000000000003';
  const executionId = '77777777-7777-4777-8777-000000000003';
  const stepId = '55555555-5555-4555-8555-000000000003';
  const attempts = [2, 4, 7, 9, 12].map((attempt, index) =>
    workflowStepAttemptDto({
      id: `66666666-6666-4666-8666-${String(index + 3).padStart(12, '0')}`,
      step_id: stepId,
      attempt,
      execution_order: index + 1,
      status: 'failed',
      exit_code: 1,
      gate_result: {kind: 'failed', passed: false, source: 'step.exit_code == 0', exit_code: 1},
      finished_at: `2026-09-10T09:0${index}:30.000Z`,
    }),
  );
  const error = {
    message: 'The gate did not pass after 5 attempts.',
    reason: 'restart_exhausted' as const,
    attempt_count: 5,
    max_attempts: 5,
    restart_from: 'implement',
  };
  const job = workflowJob({
    id: jobId,
    name: 'implementation',
    key: 'implementation',
    status: 'failed',
    job_executions: [
      workflowJobExecutionDto({
        id: executionId,
        job_id: jobId,
        status: 'failed',
        steps: [
          workflowStepDto({
            id: stepId,
            job_execution_id: executionId,
            name: 'Verify implementation',
            key: 'verify',
            status: 'failed',
            status_reason: 'restart_exhausted',
            gate_max_attempts: 5,
            error,
            attempts,
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Story fixture is missing a job execution.');

  const entry = buildStepListModel({job, jobExecution: execution}).entries.at(-1);
  if (!entry) throw new Error('Story fixture is missing a gate attempt.');

  return entry;
}

function runnerLossEntry(reason: RunnerLossReason): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-000000000004';
  const executionId = '77777777-7777-4777-8777-000000000004';
  const stepId = '55555555-5555-4555-8555-000000000004';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'failed',
    status_reason: reason,
    job_executions: [
      workflowJobExecutionDto({
        id: executionId,
        job_id: jobId,
        status: 'failed',
        status_reason: reason,
        steps: [
          workflowStepDto({
            id: stepId,
            job_execution_id: executionId,
            name: 'Run verification',
            key: 'run-verification',
            status: 'failed',
            status_reason: 'runner_lost',
            config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
            error: null,
            attempts: [
              workflowStepAttemptDto({
                id: '66666666-6666-4666-8666-000000000004',
                step_id: stepId,
                status: 'failed',
                error: null,
                finished_at: '2026-09-19T09:04:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Story fixture is missing a job execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Story fixture is missing a step attempt.');

  return entry;
}

function toolStepEntry(outcome: ToolStepOutcome): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-000000000002';
  const executionId = '77777777-7777-4777-8777-000000000002';
  const stepId = '55555555-5555-4555-8555-000000000002';
  const attemptId = '66666666-6666-4666-8666-000000000002';
  const failed = outcome === 'failed';
  const retrying = outcome === 'running';
  const invocations = toolStoryInvocations(outcome);
  const error = failed
    ? {
        message: 'Slack rejected the token for this workspace.',
        code: 'access-denied',
        reason: 'tool_error' as const,
      }
    : null;
  const job = workflowJob({
    id: jobId,
    name: 'release',
    key: 'release',
    status: outcome,
    job_executions: [
      workflowJobExecutionDto({
        id: executionId,
        job_id: jobId,
        status: outcome,
        steps: [
          workflowStepDto({
            id: stepId,
            job_execution_id: executionId,
            name: 'Post release notice',
            key: 'notify-release',
            status: outcome,
            source_location: {start_line: 20, end_line: 29},
            type: 'tool',
            config: {
              tool: {
                provider: 'slack',
                connection_slug: 'release-notifications',
                id: 'chat_post_message',
                method: 'post',
                sensitivity: 'write',
              },
            },
            error,
            attempts: [
              workflowStepAttemptDto({
                id: attemptId,
                step_id: stepId,
                status: outcome,
                output:
                  outcome === 'succeeded'
                    ? {result: {ts: '1717171717.000100', channel: 'C012345'}}
                    : null,
                outputs: outcome === 'succeeded' ? {message_id: '1717171717.000100'} : null,
                error,
                invocations,
                finished_at: retrying ? null : '2026-06-26T11:59:57.412Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Story fixture is missing a job execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Story fixture is missing a step attempt.');
  return entry;
}

function toolStoryInvocations(outcome: ToolStepOutcome): StepAttemptDto['invocations'] {
  if (outcome === 'running') {
    return [
      {
        call_index: 0,
        started_at: '2026-06-26T11:59:57.000Z',
        finished_at: '2026-06-26T11:59:57.412Z',
        outcome: 'error',
        error_code: 'rate-limited',
        duration_ms: 412,
      },
      {
        call_index: 1,
        started_at: '2026-06-26T11:59:58.000Z',
        // Storybook freezes Date.now(), so this stays a deterministic five-second countdown.
        next_due_at: new Date(Date.now() + 5000).toISOString(),
      },
    ];
  }
  if (outcome === 'failed') {
    return [
      {
        call_index: 0,
        started_at: '2026-06-26T11:59:57.000Z',
        finished_at: '2026-06-26T11:59:57.412Z',
        outcome: 'error',
        error_code: 'access-denied',
        duration_ms: 412,
      },
    ];
  }
  return [
    {
      call_index: 0,
      started_at: '2026-06-26T11:59:57.000Z',
      finished_at: '2026-06-26T11:59:57.412Z',
      outcome: 'success',
      duration_ms: 412,
    },
  ];
}

function toolStepDetail(stepId: string): StepAttemptDetail {
  return {
    stepId,
    attempt: 1,
    session: null,
    authoredConfig: {
      tool: {
        provider: 'slack',
        connection: 'release-notifications',
        id: 'chat_post_message',
        with: {channel: `\${{ inputs.channel }}`, text: `\${{ inputs.message }}`},
      },
    },
    config: {
      tool: {
        provider: 'slack',
        connection_slug: 'release-notifications',
        id: 'chat_post_message',
        with: {channel: '#releases', text: 'Version 2.4.0 is live.'},
      },
    },
    toolArguments: {channel: '#releases', text: 'Version 2.4.0 is live.'},
    evaluationTrace: null,
  };
}
