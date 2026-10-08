import type {StepAttemptDetailResponseDto, StepAttemptDto} from '@shipfox/api-workflows-dto';
import {configureApiClient, resetApiClient} from '@shipfox/client-api';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {act, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import type {JobStatusReason, StepErrorReason} from '#core/workflow-run.js';
import {stepAttemptDetailQueryKeys} from '#hooks/api/step-attempt-detail.js';
import type {WorkflowStepFixtureDto} from '#test/fixtures/workflow-run.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {buildStepListModel, type StepListEntryModel} from '../step-list/step-list-model.js';
import {StepInspectorSheet} from './step-troubleshooting.js';

const STEP_ID = '55555555-5555-4555-8555-555555555555';
const ATTEMPT_ID = '66666666-6666-4666-8666-666666666666';
const EXECUTION_ID = '77777777-7777-4777-8777-777777777777';
const INSPECTOR_TRIGGER_NAME = 'Open inspector';
const INVOCATION_LOG_DESCRIPTION = /The invocation log has the full result\./u;
const MASKED_SECRET_INPUT = /\*\*\* \(secrets\.SLACK_TOKEN\)/u;

describe('StepInspectorSheet', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetApiClient();
  });

  it('shows a loading state only after the inspector is opened', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    await renderPanel();

    expect(screen.queryByRole('status', {name: 'Loading troubleshooting details'})).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(
      await screen.findByRole('status', {name: 'Loading troubleshooting details'}),
    ).toBeInTheDocument();
  });

  it('keeps failure detail out of the default log path', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    await renderPanel();

    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it.each([
    {
      reason: 'agent_session_key_invalid',
      title: 'The session name is not valid',
      description:
        'Start the session name with a letter or digit. Use only letters, digits, dots, underscores, or hyphens.',
    },
    {
      reason: 'agent_inference_credentials_unavailable',
      title: 'Shipfox cannot reach the model provider',
      description: 'Rerun the job. If it fails again, check the model provider in Agents settings.',
    },
    {
      reason: 'agent_session_held',
      title: 'Another step is using this session',
      description:
        'Two steps that run at the same time cannot continue one session. Give each step its own session.',
    },
    {
      reason: 'agent_session_harness_mismatch',
      title: 'This session uses another harness',
      description:
        'A session works with one harness only. Use the harness of the first step, or use a new session.',
    },
    {
      reason: 'agent_session_unavailable',
      title: 'Shipfox cannot load the session',
      description: 'Rerun the failed jobs. If it fails again, use a new session.',
    },
  ] as const)('explains the $reason failure', async ({reason, title, description}) => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => new Promise<Response>(() => undefined)),
    });

    await renderPanel({entry: stepEntry(reason)});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
  });

  it.each([
    {
      reason: 'run_cancelled',
      title: 'The run is cancelled',
      description: 'Start a new run if you still need the result.',
    },
    {
      reason: 'timed_out',
      title: 'The step took too long',
      description:
        'The step did not finish before its timeout. Raise the timeout or make the step faster, then start a new run.',
    },
    {
      reason: 'lease_expired',
      title: 'The runner stopped responding',
      description: 'Rerun the job. If it fails again, contact your workspace admin.',
    },
    {
      reason: 'provider_lost',
      title: 'The runner stopped responding',
      description: 'Rerun the job. If it fails again, contact your workspace admin.',
    },
    {
      reason: 'lifecycle_violation',
      title: 'The runner stopped responding',
      description: 'Rerun the job. If it fails again, contact your workspace admin.',
    },
    {
      reason: 'runner_lost',
      title: 'The runner stopped responding',
      description: 'Rerun the job. If it fails again, contact your workspace admin.',
    },
  ] as const)('distinguishes the $reason failure', async ({reason, title, description}) => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({entry: jobFailureStepEntry(reason), jobStatusReason: reason});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it('does not replace a specific step failure with the job failure reason', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('agent_invocation_failed'),
      jobStatusReason: 'provider_lost',
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('The agent failed')).toBeInTheDocument();
    expect(screen.queryByText('The runner stopped responding')).toBeNull();
  });

  it('shows the evaluation count only after the lazy detail response arrives', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            evaluation_trace: [
              {
                expression: 'inputs.message',
                roots: ['inputs.message'],
                fill_target: 'run',
                evaluated_at: '2026-08-05T12:00:00.000Z',
                field: 'run',
                value: 'hello',
              },
            ],
          }),
        ),
      ),
    });

    await renderPanel();

    expect(screen.queryByText('Evaluation')).toBeNull();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect((await screen.findAllByText('Evaluation')).length).toBeGreaterThan(0);
  });

  it('renders complete attempt diagnostics from the lazy detail response', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            authored_config: {tool: {id: 'chat_post_message'}},
            config: {
              tool: {
                provider: 'slack',
                id: 'chat_post_message',
                with: {channel: '#releases'},
              },
            },
            output: {result: {id: 'result-1'}},
            outputs: {message_id: 'message-1'},
            response: 'provider response',
            error: {message: 'diagnostic warning', reason: 'tool_error'},
            gate_result: {kind: 'passed', passed: true, source: 'exit 0', exit_code: 0},
            invocations: [
              {
                call_index: 0,
                started_at: '2026-09-01T09:00:00.000Z',
                finished_at: '2026-09-01T09:00:00.412Z',
                outcome: 'success',
                duration_ms: 412,
              },
            ],
            restart_feedback: 'Restarted from the previous attempt.',
          }),
        ),
      ),
    });

    await renderPanel({entry: toolStepEntry({status: 'succeeded'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByRole('region', {name: 'Authored configuration'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Invocations'})).toHaveTextContent('Succeeded');
    expect(screen.getByText('provider response')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Attempt diagnostics'})).toHaveTextContent(
      'diagnostic warning',
    );
    expect(screen.getByRole('region', {name: 'Attempt diagnostics'})).toHaveTextContent(
      'Restarted from the previous attempt.',
    );
  });

  it('renders a failed gate in attempt diagnostics', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            gate_result: {kind: 'failed', passed: false, source: 'exit 1', exit_code: 1},
          }),
        ),
      ),
    });

    await renderPanel({entry: toolStepEntry({status: 'failed'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const diagnostics = await screen.findByRole('region', {name: 'Attempt diagnostics'});
    expect(diagnostics).toHaveTextContent('failed');
    expect(diagnostics).toHaveTextContent('exit 1');
  });

  it('renders typed unavailable states for oversized diagnostic fields', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            oversized_fields: [
              {
                field: 'config',
                stored_bytes: 70_000,
                reason: 'legacy_value_exceeds_inline_limit',
              },
              {
                field: 'output',
                stored_bytes: 300_000,
                reason: 'legacy_value_exceeds_inline_limit',
              },
              {
                field: 'evaluation_trace',
                stored_bytes: 70_000,
                reason: 'legacy_value_exceeds_inline_limit',
              },
              {
                field: 'filter_snapshot',
                stored_bytes: 524_300,
                reason: 'value_exceeds_inline_limit',
              },
            ],
          }),
        ),
      ),
    });

    await renderPanel({entry: emptyStepEntry()});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const unavailable = await screen.findByRole('region', {name: 'Unavailable diagnostics'});
    expect(unavailable).toHaveTextContent('Resolved configuration');
    expect(unavailable).toHaveTextContent('Step output');
    expect(unavailable).toHaveTextContent('Evaluation');
    expect(unavailable).toHaveTextContent('Listener filter snapshot');
    expect(unavailable).toHaveTextContent('Too large to display (300,000 bytes)');
  });

  it('shows the session descriptor without transcript data', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            session: {
              id: '99999999-9999-4999-8999-999999999999',
              key: 'main',
              mode: 'resume',
              segment: 2,
            },
            evaluation_trace: null,
          }),
        ),
      ),
    });

    await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const session = await screen.findByRole('region', {name: 'Agent session'});
    expect(session).toHaveTextContent('resume');
    expect(within(session).getByText('main')).toBeInTheDocument();
    expect(within(session).getByText('Segment 2 loaded')).toBeInTheDocument();
  });

  it('hides an absent session descriptor while preserving the inspector', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            session: null,
            evaluation_trace: null,
          }),
        ),
      ),
    });

    await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByRole('region', {name: 'Inputs'})).toBeInTheDocument();
  });

  it('shows an actionable error and retries the detail request', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}))
      .mockResolvedValueOnce(
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            evaluation_trace: null,
          }),
        ),
      );
    configureApiClient({fetchImpl});

    await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Details unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Retry'}));
    const inputs = await screen.findByRole('region', {name: 'Inputs'});
    expect(within(inputs).getByText('Resolved')).toBeInTheDocument();
    expect(
      within(inputs).getByRole('button', {name: 'Authored configuration'}),
    ).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the last successful detail while a refresh fails', async () => {
    const user = userEvent.setup();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          stepDetailResponse({
            authored_config: {run: 'pnpm test'},
            config: {run: 'pnpm test --filter=client'},
            evaluation_trace: null,
          }),
        ),
      )
      .mockResolvedValueOnce(jsonResponse({code: 'server-error'}, {status: 500}));
    configureApiClient({fetchImpl});

    const {queryClient} = await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(await screen.findByRole('region', {name: 'Inputs'})).toBeInTheDocument();

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: stepAttemptDetailQueryKeys.detail(STEP_ID, 1),
      });
    });

    expect(await screen.findByText('Shipfox cannot refresh these details.')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Inputs'})).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps the annotation link available when the detail request fails', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(() => Promise.resolve(jsonResponse({code: 'server-error'}, {status: 500}))),
    });

    await renderPanel({annotationCount: 2});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Details unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'View 2 annotations'})).toBeInTheDocument();
  });

  it('does not replace an annotation link with an empty inspector state', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: null,
            config: null,
            evaluation_trace: null,
          }),
        ),
      ),
    });

    await renderPanel({annotationCount: 2, entry: emptyStepEntry()});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByRole('link', {name: 'View 2 annotations'})).toBeInTheDocument();
    expect(screen.queryByText('No additional troubleshooting details were recorded.')).toBeNull();
  });

  it('does not show current step configuration or evaluation for a historical attempt', async () => {
    const user = userEvent.setup();
    configureApiClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          stepDetailResponse({
            step_id: STEP_ID,
            attempt: 1,
            authored_config: null,
            config: null,
            evaluation_trace: null,
          }),
        ),
      ),
    });

    await renderPanel();
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));
    expect(await screen.findByRole('region', {name: 'Outputs'})).toBeInTheDocument();

    expect(screen.queryByText('Authored configuration')).toBeNull();
    expect(screen.queryByText('Resolved configuration')).toBeNull();
    expect(screen.queryByText('Evaluation')).toBeNull();
  });

  it('shows resolved arguments, results, invocations, outputs, and write sensitivity', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({entry: toolStepEntry({status: 'succeeded'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Write tool')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Arguments'})).toHaveTextContent('#releases');
    expect(screen.getByRole('region', {name: 'Result'})).toHaveTextContent('1717171717.000100');
    expect(screen.getByRole('region', {name: 'Invocations'})).toHaveTextContent('Succeeded');
    expect(screen.getByRole('region', {name: 'Invocations'})).toHaveTextContent('412ms');
    expect(screen.getByRole('region', {name: 'Outputs'})).toHaveTextContent('message_id');
  });

  it('explains provider access failures and links to recovery and logs', async () => {
    const user = userEvent.setup();
    const onViewLogs = vi.fn();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({status: 'failed', reason: 'tool_error', code: 'access-denied'}),
      onViewLogs,
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('The integration denied access')).toBeInTheDocument();
    expect(
      screen.getByText('Check the permissions of the integration connection. Then rerun the job.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Slack rejected the token.')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Review integration access'})).toHaveAttribute(
      'href',
      '/w/acme/settings/integrations',
    );
    const invocations = screen.getByRole('region', {name: 'Invocations'});
    expect(invocations).toHaveTextContent('Failed');
    const errorCode = within(invocations).getByText('access-denied');
    expect(errorCode).toHaveAttribute('tabindex', '0');
    await user.hover(errorCode);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('access-denied');
    expect(screen.queryByRole('region', {name: 'Result'})).toBeNull();

    await user.click(screen.getByRole('button', {name: 'View invocation log'}));
    expect(onViewLogs).toHaveBeenCalledOnce();
  });

  it('keeps the source action but hides invocation logs for pre-dispatch failures', async () => {
    const user = userEvent.setup();
    const onViewLogs = vi.fn();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: toolStepEntry({status: 'failed', reason: 'config_unresolvable'}),
      onViewLogs,
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('A value in this step has an error')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'View in source'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'View invocation log'})).toBeNull();
  });

  it('shows the stored cause when a step condition cannot be evaluated', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({entry: toolStepEntry({status: 'failed', reason: 'condition_errored'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('A step condition has an error')).toBeInTheDocument();
    expect(
      screen.getByText('Tool output was invalid. Fix the condition, then start a new run.'),
    ).toBeInTheDocument();
  });

  it('explains unavailable credentials and links to reconnection', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({
        status: 'failed',
        reason: 'tool_error',
        code: 'credentials-unavailable',
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Reconnect the integration')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Shipfox cannot use the credentials of this integration. Reconnect it, then rerun the job.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Reconnect integration'})).toHaveAttribute(
      'href',
      '/w/acme/settings/integrations',
    );
  });

  it('shows a countdown for a scheduled retry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2999-09-01T09:00:01.000Z'));
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({entry: toolStepEntry({status: 'running'})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByRole('region', {name: 'Invocations'})).toHaveTextContent('Failed');
    expect(screen.getByRole('region', {name: 'Invocations'})).toHaveTextContent('Retry pending');
    expect(screen.getByText('Retry in 5s')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    {nextDueAt: '2999-09-01T09:00:00.000Z', label: 'Retry in now'},
    {nextDueAt: 'not-a-date', label: 'Retry in pending'},
  ])('shows $label for a running retry', async ({nextDueAt, label}) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2999-09-01T09:00:01.000Z'));
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({entry: toolStepEntry({status: 'running', nextDueAt})});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it('marks a queued retry as not retried after the attempt terminates', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({status: 'failed', reason: 'invocation_interrupted'}),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('Not retried')).toBeInTheDocument();
  });

  it.each([
    {
      sensitivity: 'write',
      description: 'The change may already exist. Check the integration before you rerun the job.',
    },
    {
      sensitivity: 'read',
      description:
        'Shipfox does not know the result of the call. Read the invocation log, then rerun the job.',
    },
  ] as const)('explains an interrupted $sensitivity tool invocation', async ({
    sensitivity,
    description,
  }) => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({
        status: 'failed',
        reason: 'invocation_interrupted',
        sensitivity,
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText(description)).toBeInTheDocument();
  });

  it('distinguishes a successful provider call from an invalid step output', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({status: 'failed', reason: 'output_invalid', code: 'output-too-large'}),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(
      await screen.findByText('The tool call worked, but the step failed'),
    ).toBeInTheDocument();
    expect(screen.getByText(INVOCATION_LOG_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Result'})).toBeNull();
  });

  it('points an invalid resolved tool field back to source', async () => {
    const user = userEvent.setup();
    configureToolDetailResponse();

    await renderPanel({
      entry: toolStepEntry({
        status: 'failed',
        reason: 'tool_config_invalid',
        code: 'invalid-argument',
        field: 'tool.with.channel',
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('A tool input is not valid')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The value of tool.with.channel is not valid. Fix it in the step, then start a new run.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'View in source'})).toBeInTheDocument();
  });

  it('uses neutral guidance when restart exhaustion has no success gate', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('restart_exhausted', undefined, {
        message: 'The step failed after 3 attempts.',
        attempt_count: 3,
        max_attempts: 3,
        restart_from: 'producer',
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('The step reached its attempt limit')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The step failed 3 times. The limit is 3 attempts. Fix the cause, or raise gate.on_failure.max_attempts. Then start a new run.',
      ),
    ).toBeInTheDocument();
  });

  it('explains success-gate exhaustion with the structured count and limit', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('restart_exhausted', undefined, {
        message: 'The gate did not pass after 5 attempts.',
        attempt_count: 5,
        max_attempts: 5,
        restart_from: 'producer',
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('The step reached its attempt limit')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The success condition failed 5 times. The limit is 5 attempts. Fix the cause, or raise gate.on_failure.max_attempts. Then start a new run.',
      ),
    ).toBeInTheDocument();
  });

  it('uses the effective gate limit for a legacy exhaustion error', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});
    const entry = stepEntry('restart_exhausted', undefined, {
      message: 'The gate did not pass after 5 attempts.',
      attempt_count: 5,
      restart_from: 'producer',
    });
    entry.step.gateMaxAttempts = 5;

    await renderPanel({entry});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(
      await screen.findByText(
        'The success condition failed 5 times. The limit is 5 attempts. Fix the cause, or raise gate.on_failure.max_attempts. Then start a new run.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps useful fallback copy for an unknown future reason', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({entry: stepEntry('future_failure' as StepErrorReason)});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('The step failed')).toBeInTheDocument();
    expect(screen.getByText('Read the details below. Then rerun the job.')).toBeInTheDocument();
  });

  it('shows provider recovery exhaustion without the raw provider message', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('agent_invocation_failed', 'provider_stream_interrupted', {
        message: 'Stream error occurred',
        category: 'provider',
        managed_provider_id: 'shipfox',
        retryable: true,
        attempt_count: 4,
        max_attempts: 4,
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('The model response stopped')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The connection to Shipfox dropped during the model response. Shipfox tried 4 times. Your workflow has no error. Rerun the failed jobs.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('provider')).toBeInTheDocument();
    expect(screen.getByText('Shipfox')).toBeInTheDocument();
    expect(screen.getByText('4 of 4')).toBeInTheDocument();
    expect(screen.getByText('provider_stream_interrupted')).toBeInTheDocument();
    expect(screen.queryByText('Stream error occurred')).toBeNull();
  });

  it('uses the Shipfox fallback consistently when provider metadata is absent', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('agent_invocation_failed', 'provider_stream_interrupted', {
        message: 'Stream error occurred',
        category: 'provider',
        retryable: true,
        attempt_count: 4,
        max_attempts: 4,
      }),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(
      await screen.findByText(
        'The connection to Shipfox dropped during the model response. Shipfox tried 4 times. Your workflow has no error. Rerun the failed jobs.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Shipfox')).toBeInTheDocument();
  });

  it('keeps non-tool failure chips keyed to their stable reason', async () => {
    const user = userEvent.setup();
    configureApiClient({fetchImpl: vi.fn(() => new Promise<Response>(() => undefined))});

    await renderPanel({
      entry: stepEntry('agent_invocation_failed', 'workspace-providers-disabled'),
    });
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    expect(await screen.findByText('agent_invocation_failed')).toBeInTheDocument();
  });
});

describe('StepInspectorSheet for action steps', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetApiClient();
  });

  it('shows the action, its masked inputs, and each binding with read and write grants', async () => {
    const user = userEvent.setup();
    configureActionDetailResponse();

    await renderPanel({entry: actionStepEntry()});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const action = await screen.findByRole('region', {name: 'Action'});
    expect(within(action).getByText('./.shipfox/actions/slack-thread')).toBeInTheDocument();
    expect(within(action).getByText('sha256:0123456789ab')).toBeInTheDocument();
    expect(within(action).getByText('Slack thread to Markdown')).toBeInTheDocument();
    expect(screen.getByText('Attempt #1').nextElementSibling).toHaveTextContent('Action');
    const inputs = screen.getByRole('region', {name: 'Inputs'});
    expect(within(inputs).getByText('C0123')).toBeInTheDocument();
    expect(within(inputs).getByText(MASKED_SECRET_INPUT)).toBeInTheDocument();
    const tools = screen.getByRole('list', {name: 'Tools granted to slack'});
    expect(within(tools).getByText('read_thread').parentElement).toHaveTextContent('Read');
    expect(within(tools).getByText('post_message').parentElement).toHaveTextContent('Write');
    expect(screen.getByText('team-slack')).toBeInTheDocument();
  });

  it.each([
    {
      name: 'an unavailable snapshot',
      error: {reason: 'action_unavailable', message: 'Digest mismatch'},
      title: 'The runner cannot load the action',
      code: 'action_unavailable',
    },
    {
      name: 'an invalid input',
      error: {reason: 'action_input_invalid', message: 'Action input "limit" is required.'},
      title: 'An action input is not valid',
      code: 'action_input_invalid',
    },
    {
      name: 'an early exit',
      error: {message: 'The action exited before it finished.', exit_code: 0},
      title: 'The action exited before it finished',
      code: 'exit 0',
    },
    {
      name: 'an out-of-memory kill',
      error: {
        message: 'The action was killed (SIGKILL). It likely ran out of memory.',
        signal: 'SIGKILL',
      },
      title: 'The action ran out of memory',
      code: 'SIGKILL',
    },
    {
      name: 'a missing, undeclared, or mistyped output',
      error: {reason: 'output_invalid', message: 'Output "path" is required.'},
      title: 'An action output is not valid',
      code: 'output_invalid',
    },
    {
      name: 'an output over its size limit',
      error: {reason: 'step_result_too_large', message: 'Output "report" is too large.'},
      title: 'Action output is too large',
      code: 'step_result_too_large',
    },
  ] as const)('explains $name', async ({error, title, code}) => {
    const user = userEvent.setup();
    configureActionDetailResponse();

    await renderPanel({entry: actionStepEntry(error), onViewLogs: () => undefined});
    await user.click(screen.getByRole('button', {name: INSPECTOR_TRIGGER_NAME}));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(title)).toBeInTheDocument();
    expect(within(alert).getByText(error.message)).toBeInTheDocument();
    expect(within(alert).getByText(code)).toBeInTheDocument();
    expect(within(alert).getByRole('button', {name: 'View logs'})).toBeInTheDocument();
  });
});

async function renderPanel({
  annotationCount,
  entry,
  jobStatusReason,
  onViewLogs,
}: {
  annotationCount?: number;
  entry?: StepListEntryModel;
  jobStatusReason?: JobStatusReason | null | undefined;
  onViewLogs?: (() => void) | undefined;
} = {}) {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const rootRoute = createRootRoute({component: Outlet});
  const panelRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => (
      <QueryClientProvider client={queryClient}>
        <PanelHarness
          annotationCount={annotationCount}
          entry={entry}
          jobStatusReason={jobStatusReason}
          onViewLogs={onViewLogs}
        />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/w/acme/p/platform/runs/run-1']}),
    routeTree: rootRoute.addChildren([panelRoute]),
  });
  await router.load();
  let result: ReturnType<typeof render> | undefined;
  await act(() => {
    result = render(<RouterProvider router={router} />);
  });
  if (!result) throw new Error('Step inspector did not render.');
  return {result, queryClient};
}

function PanelHarness({
  annotationCount,
  entry: providedEntry,
  jobStatusReason,
  onViewLogs,
}: {
  annotationCount?: number | undefined;
  entry?: StepListEntryModel | undefined;
  jobStatusReason?: JobStatusReason | null | undefined;
  onViewLogs?: (() => void) | undefined;
}) {
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const entry = providedEntry ?? stepEntry();
  return (
    <>
      <button type="button" onClick={() => setInspectorOpen(true)}>
        Open inspector
      </button>
      <StepInspectorSheet
        entry={entry}
        jobStatusReason={jobStatusReason}
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        workspaceSlug="acme"
        projectSlug="platform"
        workflowRunId="11111111-1111-4111-8111-111111111111"
        runAttempt={1}
        jobId="44444444-4444-4444-8444-444444444444"
        annotationCount={annotationCount}
        onViewLogs={onViewLogs}
      />
    </>
  );
}

function stepEntry(
  reason: StepErrorReason = 'agent_invocation_failed',
  code?: string,
  errorOverrides: Partial<NonNullable<WorkflowStepFixtureDto['error']>> = {},
): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'failed',
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status: 'failed',
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Run verification',
            status: 'failed',
            type: 'agent',
            config: {run: 'pnpm test'},
            error: {
              message: 'Agent dispatch failed',
              reason,
              ...(code ? {code} : {}),
              ...errorOverrides,
            },
            evaluation_trace: [
              {
                expression: 'inputs.message',
                roots: ['inputs.message'],
                fill_target: 'run',
                evaluated_at: '2026-08-05T12:00:00.000Z',
                field: 'run',
                value: 'current attempt value',
              },
            ],
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status: 'failed',
                output: {result: 'failed'},
                finished_at: '2026-08-05T12:01:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');

  return entry;
}

type PresentedJobFailureReason = Extract<
  JobStatusReason,
  | 'run_cancelled'
  | 'timed_out'
  | 'lease_expired'
  | 'provider_lost'
  | 'lifecycle_violation'
  | 'runner_lost'
>;

function jobFailureStepEntry(reason: PresentedJobFailureReason): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'failed',
    status_reason: reason,
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status: 'failed',
        status_reason: reason,
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Run verification',
            status: 'failed',
            status_reason:
              reason === 'lease_expired' ||
              reason === 'provider_lost' ||
              reason === 'lifecycle_violation'
                ? 'runner_lost'
                : reason,
            type: 'run',
            config: {run: 'pnpm test'},
            error: null,
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status: 'failed',
                error: null,
                finished_at: '2026-08-05T12:01:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');

  return entry;
}

function emptyStepEntry(): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'succeeded',
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status: 'succeeded',
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Run verification',
            status: 'succeeded',
            config: {},
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status: 'succeeded',
                output: null,
                outputs: null,
                response: null,
                error: null,
                exit_code: 0,
                finished_at: '2026-08-05T12:01:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');

  return entry;
}

function toolStepEntry({
  status,
  reason,
  code,
  field,
  sensitivity = 'write',
  nextDueAt = '2999-09-01T09:00:06.000Z',
}: {
  status: 'succeeded' | 'failed' | 'running';
  reason?: StepErrorReason | undefined;
  code?: string | undefined;
  field?: string | undefined;
  sensitivity?: 'read' | 'write' | undefined;
  nextDueAt?: string | undefined;
}): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const error = toolTestError(reason, code, field);
  const invocations = toolTestInvocations(status, reason, code, nextDueAt);
  const succeeded = status === 'succeeded';
  const running = status === 'running';
  const output = succeeded ? {result: {ts: '1717171717.000100'}} : null;
  const outputs = succeeded ? {message_id: '1717171717.000100'} : null;
  const finishedAt = running ? null : '2026-09-01T09:00:00.412Z';
  const job = workflowJob({
    id: jobId,
    name: 'release',
    key: 'release',
    status,
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status,
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Post release notice',
            key: 'notify-release',
            status,
            source_location: {start_line: 20, end_line: 29},
            type: 'tool',
            config: {
              tool: {
                provider: 'slack',
                connection_slug: 'release-notifications',
                id: 'chat_post_message',
                method: 'post',
                sensitivity,
              },
            },
            error,
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status,
                output,
                outputs,
                error,
                invocations,
                finished_at: finishedAt,
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');
  return entry;
}

function toolTestInvocations(
  status: 'succeeded' | 'failed' | 'running',
  reason: StepErrorReason | undefined,
  code: string | undefined,
  nextDueAt: string,
): StepAttemptDto['invocations'] {
  if (status === 'running') {
    return [
      {
        call_index: 0,
        started_at: '2026-09-01T09:00:00.000Z',
        finished_at: '2026-09-01T09:00:00.412Z',
        outcome: 'error',
        error_code: 'rate-limited',
        duration_ms: 412,
      },
      {
        call_index: 1,
        started_at: '2026-09-01T09:00:01.000Z',
        next_due_at: nextDueAt,
      },
    ];
  }
  if (reason === 'tool_error') {
    return [
      {
        call_index: 0,
        started_at: '2026-09-01T09:00:00.000Z',
        finished_at: '2026-09-01T09:00:00.412Z',
        outcome: 'error',
        ...(code ? {error_code: code} : {}),
        duration_ms: 412,
      },
    ];
  }
  if (reason === 'invocation_interrupted') {
    return [
      {
        call_index: 0,
        started_at: '2026-09-01T09:00:01.000Z',
        next_due_at: nextDueAt,
      },
    ];
  }
  if (status === 'succeeded' || reason === 'output_invalid') {
    return [
      {
        call_index: 0,
        started_at: '2026-09-01T09:00:00.000Z',
        finished_at: '2026-09-01T09:00:00.412Z',
        outcome: 'success',
        duration_ms: 412,
      },
    ];
  }
  return [];
}

function toolTestError(
  reason: StepErrorReason | undefined,
  code: string | undefined,
  field: string | undefined,
): WorkflowStepFixtureDto['error'] {
  if (!reason) return null;
  const message =
    code === 'access-denied' ? 'Slack rejected the token.' : 'Tool output was invalid.';
  return {
    message,
    reason,
    ...(code ? {code} : {}),
    ...(field ? {field, source: 'resolved'} : {}),
  };
}

function stepDetailResponse(
  overrides: Partial<StepAttemptDetailResponseDto> = {},
): StepAttemptDetailResponseDto {
  return {
    workflow_run_id: '11111111-1111-4111-8111-111111111111',
    workflow_run_attempt: 1,
    job_id: '44444444-4444-4444-8444-444444444444',
    job_execution_id: EXECUTION_ID,
    step_id: STEP_ID,
    step_attempt_id: ATTEMPT_ID,
    attempt: 1,
    authored_config: null,
    config: null,
    session: null,
    evaluation_trace: null,
    oversized_fields: [],
    ...overrides,
  };
}

function configureToolDetailResponse() {
  configureApiClient({
    fetchImpl: vi.fn(async () =>
      jsonResponse(
        stepDetailResponse({
          step_id: STEP_ID,
          attempt: 1,
          authored_config: {
            tool: {
              provider: 'slack',
              connection: 'release-notifications',
              id: 'chat_post_message',
              with: {channel: `\${{ inputs.channel }}`},
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
          evaluation_trace: null,
        }),
      ),
    ),
  });
}

function actionStepEntry(
  error: Partial<NonNullable<WorkflowStepFixtureDto['error']>> | null = null,
): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-444444444444';
  const status = error ? 'failed' : 'succeeded';
  const stepError = error ? {message: 'Action failed', ...error} : null;
  const job = workflowJob({
    id: jobId,
    name: 'investigate',
    key: 'investigate',
    status,
    job_executions: [
      workflowJobExecutionDto({
        id: EXECUTION_ID,
        job_id: jobId,
        status,
        steps: [
          workflowStepDto({
            id: STEP_ID,
            job_execution_id: EXECUTION_ID,
            name: 'Save the thread',
            status,
            type: 'action',
            source_location: {start_line: 8, end_line: 14},
            error: stepError,
            attempts: [
              workflowStepAttemptDto({
                id: ATTEMPT_ID,
                step_id: STEP_ID,
                status,
                error: stepError,
                finished_at: '2026-09-27T12:01:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Test fixture is missing an execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Test fixture is missing a step attempt.');
  return entry;
}

function configureActionDetailResponse() {
  const detail = stepDetailResponse({
    config: {
      action: {
        uses: './.shipfox/actions/slack-thread',
        digest: `sha256:0123456789ab${'c'.repeat(52)}`,
        main: 'index.ts',
        name: 'Slack thread to Markdown',
      },
      inputs: {channel_id: 'C0123'},
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
            {id: 'post_message', sensitivity: 'write', result: 'json'},
          ],
        },
      ],
    },
  });
  configureApiClient({
    fetchImpl: vi.fn(async (input: RequestInfo | URL) =>
      (input instanceof Request ? input.url : String(input)).includes(
        `/workflows/runs/steps/${STEP_ID}/attempts/1`,
      )
        ? jsonResponse(detail)
        : jsonResponse({code: 'not-found'}, {status: 404}),
    ),
  });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {'content-type': 'application/json'},
    ...init,
  });
}
