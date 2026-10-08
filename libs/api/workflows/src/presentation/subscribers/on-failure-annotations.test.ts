import {
  type AnnotationsInterModuleClient,
  annotationsInterModuleContract,
} from '@shipfox/annotations-dto/inter-module';
import type {
  AgentConfigIssueDto,
  StepErrorReasonDto,
  WorkflowsJobTerminatedEventDto,
  WorkflowsStepAttemptTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {createInterModuleKnownError} from '@shipfox/inter-module';
import type {Step, StepAttempt} from '#core/entities/step.js';
import {
  onJobTerminatedFailureAnnotation,
  onStepAttemptTerminatedFailureAnnotation,
} from './on-failure-annotations.js';

const dbMocks = vi.hoisted(() => ({
  getJobExecutionFailureOrigin: vi.fn(),
  getJobScope: vi.fn(),
  getStepAttemptDetail: vi.fn(),
  getWorkflowRunAttemptById: vi.fn(),
}));

const metricMocks = vi.hoisted(() => ({recordWorkflowFailureAnnotationFailed: vi.fn()}));
const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock('#db/index.js', () => dbMocks);
vi.mock('#metrics/instance.js', () => metricMocks);
vi.mock('@shipfox/node-opentelemetry', () => ({logger: () => ({warn: loggerWarn})}));

const replaceOrRemoveAnnotation = vi.fn(async () => ({}));
const annotations = {replaceOrRemoveAnnotation} as unknown as AnnotationsInterModuleClient;
const JOB_EXECUTION_ID = '66666666-6666-4666-8666-666666666666';

type MappedStepErrorReason = Exclude<
  StepErrorReasonDto,
  'agent_config_invalid' | 'invocation_interrupted'
>;

const STEP_FAILURE_CASES = [
  {
    reason: 'checkout_failed',
    type: 'checkout',
    title: 'Checkout failed',
    description:
      'Read the Git output in the step logs to find the cause. Then check the repository and ref of the checkout.',
  },
  {
    reason: 'checkout_auth_failed',
    type: 'checkout',
    title: 'The repository rejected the checkout',
    description:
      'Check that the integration connection can read this repository. Then rerun the job.',
  },
  {
    reason: 'checkout_unavailable',
    type: 'checkout',
    title: 'The runner cannot reach the repository',
    description: 'Rerun the job. If it fails again, check the network access of the runner.',
  },
  {
    reason: 'checkout_path_invalid',
    type: 'checkout',
    title: 'The checkout path is not valid',
    description:
      'Use a relative path inside the job folder, without `..` or `.git`. Then start a new run.',
  },
  {
    reason: 'checkout_destination_occupied',
    type: 'checkout',
    title: 'The checkout folder is not empty',
    description:
      'Choose an empty folder, or set `force` to replace its content. Then start a new run.',
  },
  {
    reason: 'git_unavailable',
    type: 'checkout',
    title: 'The runner cannot start Git',
    description: 'Install Git in the runner image. Then rerun the job.',
  },
  {
    reason: 'workspace_prep_failed',
    type: 'setup',
    title: 'The runner cannot prepare the job',
    description: 'Read the setup logs for the cause. Then rerun the job.',
  },
  {
    reason: 'setup_aborted',
    type: 'setup',
    title: 'The job stopped during setup',
    description:
      'A user cancelled the job, or it reached its timeout, before setup finished. Rerun the job.',
  },
  {
    reason: 'config_unresolvable',
    type: 'run',
    title: 'A value in this step has an error',
    description:
      'Shipfox cannot compute a value in this step. Fix the expression, then start a new run.',
  },
  {
    reason: 'condition_errored',
    type: 'run',
    title: 'A step condition has an error',
    description:
      'Shipfox cannot evaluate the `if` of this step. Fix the condition, then start a new run.',
  },
  {
    reason: 'output_invalid',
    type: 'run',
    title: 'The step output has the wrong shape',
    description:
      'The step output does not match the declared outputs. Fix the step or the declaration, then start a new run.',
  },
  {
    reason: 'execution_payload_too_large',
    type: 'run',
    title: 'The step input is too large',
    description: 'Make the values this step uses smaller. Then start a new run.',
  },
  {
    reason: 'step_result_too_large',
    type: 'run',
    title: 'The step result is too large',
    description: 'Make the values this step returns smaller. Then start a new run.',
  },
  {
    reason: 'agent_invocation_failed',
    type: 'agent',
    title: 'The agent failed',
    description: 'The agent stopped with an error. Read the step logs for the cause.',
  },
  {
    reason: 'agent_harness_unavailable',
    type: 'agent',
    title: 'The agent cannot start',
    description: 'The runner cannot start the agent. Rerun the job.',
  },
  {
    reason: 'agent_inference_credentials_unavailable',
    type: 'agent',
    title: 'Shipfox cannot reach the model provider',
    description: 'Rerun the job. If it fails again, check the model provider in Agents settings.',
  },
  {
    reason: 'agent_session_key_invalid',
    type: 'agent',
    title: 'The session name is not valid',
    description:
      'Start the session name with a letter or digit. Use only letters, digits, dots, underscores, or hyphens.',
  },
  {
    reason: 'agent_session_held',
    type: 'agent',
    title: 'Another step is using this session',
    description:
      'Two steps that run at the same time cannot continue one session. Give each step its own session.',
  },
  {
    reason: 'agent_session_harness_mismatch',
    type: 'agent',
    title: 'This session uses another harness',
    description:
      'A session works with one harness only. Use the harness of the first step, or use a new session.',
  },
  {
    reason: 'agent_session_unavailable',
    type: 'agent',
    title: 'Shipfox cannot load the session',
    description: 'Rerun the failed jobs. If it fails again, use a new session.',
  },
  {
    reason: 'gate_failed',
    type: 'run',
    title: 'The success condition failed',
    description:
      'The step finished, but its success condition is false. Fix the step or the condition, then start a new run.',
  },
  {
    reason: 'gate_uncheckable',
    type: 'run',
    title: 'The success condition failed',
    description:
      'Shipfox cannot evaluate the success condition. Fix the condition or the values it uses, then start a new run.',
  },
  {
    reason: 'restart_unresolved',
    type: 'run',
    title: 'The restart step does not exist',
    description:
      'Shipfox cannot find the step in `gate.on_failure.restart_from`. Fix it, then start a new run.',
  },
  {
    reason: 'restart_exhausted',
    type: 'run',
    title: 'The step reached its attempt limit',
    description: 'Fix the cause, or raise `gate.on_failure.max_attempts`. Then start a new run.',
    gateResult: {passed: false, source: 'step.exit_code == 0', exit_code: 73},
  },
  {
    reason: 'restart_exhausted',
    type: 'run',
    title: 'The step reached its attempt limit',
    description: 'Fix the cause, or raise `gate.on_failure.max_attempts`. Then start a new run.',
  },
  {
    reason: 'tool_error',
    type: 'tool',
    title: 'The integration returned an error',
    description: 'Read the error in the step details. Fix the cause, then rerun the job.',
  },
  {
    reason: 'tool_config_invalid',
    type: 'tool',
    title: 'A tool input is not valid',
    description: 'Fix the tool input in the step, then start a new run.',
  },
  {
    reason: 'action_input_invalid',
    type: 'action',
    title: 'An action input is not valid',
    description:
      'A `with` value does not match the input in `action.yml`. Fix the value or the input, then start a new run.',
  },
  {
    reason: 'action_unavailable',
    type: 'action',
    title: 'The runner cannot load the action',
    description: 'Rerun the job. If it fails again, contact your workspace admin.',
  },
] as const satisfies readonly {
  reason: MappedStepErrorReason;
  type: Step['type'];
  title: string;
  description: string;
  gateResult?: StepAttempt['gateResult'];
}[];

const AGENT_CONFIG_FAILURE_CASES = [
  {
    issue: 'step_config_invalid',
    title: 'Complete the agent step',
    description:
      'An agent step needs a prompt, a provider, a model, and a thinking level. Add the missing values, then start a new run.',
  },
  {
    issue: 'provider_not_configured',
    title: 'Connect the model provider',
    description:
      'Your workspace has no credentials for the provider of this step. Add them in Agents settings, then rerun the job.',
  },
  {
    issue: 'provider_unsupported',
    title: 'Choose another model provider',
    description:
      'The harness of this step cannot use its provider. Change the provider or the harness, then start a new run.',
  },
  {
    issue: 'model_unavailable',
    title: 'Choose another model',
    description:
      'The model of this step is not available in this workspace. Change the model, then start a new run.',
  },
  {
    issue: 'credentials_invalid',
    title: 'Update the model provider credentials',
    description:
      'The model provider rejected the saved credentials. Update them in Agents settings, then rerun the job.',
  },
] as const satisfies readonly {
  issue: AgentConfigIssueDto;
  title: string;
  description: string;
}[];

const JOB_FAILURE_CASES = [
  {
    reason: 'timed_out',
    title: 'The job took too long',
    description:
      'The job did not finish before its timeout. Raise the timeout or make the job faster. Then start a new run.',
  },
  {
    reason: 'runner_lost',
    title: 'The runner stopped responding',
    description: 'Rerun the job. If it fails again, contact your workspace admin.',
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
    reason: 'condition_errored',
    title: 'The job condition has an error',
    description: 'Shipfox cannot evaluate the `if` condition. Fix it, then start a new run.',
  },
  {
    reason: 'output_too_large',
    title: 'The job output is too large',
    description:
      'Make the job outputs smaller, or write large data to a file. Then start a new run.',
  },
  {
    reason: 'output_invalid',
    title: 'Shipfox cannot save the job output',
    description:
      'Every job output must be a valid JSON value. Fix the job outputs, then start a new run.',
  },
] as const satisfies readonly {
  reason: NonNullable<WorkflowsJobTerminatedEventDto['statusReason']>;
  title: string;
  description: string;
}[];

describe('failure annotations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('projects a failed step attempt into an error annotation', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      exitCode: 1,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 2});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        workflowRunId: payload.workflowRunId,
        workflowRunAttempt: 2,
        workflowRunAttemptId: payload.workflowRunAttemptId,
        jobId: payload.jobId,
        jobExecutionId: JOB_EXECUTION_ID,
        originStepId: payload.stepId,
        originStepAttempt: payload.attempt,
        context: `failure:step:${payload.stepId}`,
        annotation: expect.objectContaining({op: 'replace', style: 'error'}),
      }),
    );
  });

  it('names the step and the cause when its if condition cannot be evaluated', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      key: 'deploy',
      status: 'failed',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      error: {
        reason: 'condition_errored',
        field: 'step.if',
        summary: 'No such key: sha',
        message: 'internal runtime detail',
      },
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**A step condition has an error**',
            '',
            "The `if` of step `deploy` can't be evaluated: No such key: sha. Fix the condition, then start a new run.",
          ].join('\n'),
        },
      }),
    );
  });

  it('names the missing value and the skipped step in the condition error copy', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      key: 'deploy',
      status: 'failed',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      error: {
        reason: 'condition_errored',
        field: 'step.if',
        summary: '`steps.build.outputs.sha` has no value because step `build` was skipped.',
      },
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**A step condition has an error**',
            '',
            "The `if` of step `deploy` can't be evaluated: `steps.build.outputs.sha` has no value because step `build` was skipped. Fix the condition, then start a new run.",
          ].join('\n'),
        },
      }),
    );
  });

  it('shortens a long step name in the condition error copy', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      key: null,
      name: 'x'.repeat(500),
      status: 'failed',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      error: {reason: 'condition_errored', summary: 'No such key: sha', message: 'ignored'},
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: expect.objectContaining({
          body: expect.stringContaining(`\`${'x'.repeat(80)}…\``),
        }),
      }),
    );
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: expect.objectContaining({body: expect.stringContaining('x'.repeat(81))}),
      }),
    );
  });

  it('names the unresolved configuration field and reference without exposing raw details', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      error: {
        reason: 'config_unresolvable',
        field: 'agent.session',
        source: 'steps.confirm_current_head.outputs.current_head_sha',
        message:
          'Definition 99999999-9999-4999-8999-999999999999 resolved secret value super-secret',
      },
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**A value in this step has an error**',
            '',
            '`agent.session` uses `steps.confirm_current_head.outputs.current_head_sha`, but that value does not exist. Fix it, then start a new run.',
          ].join('\n'),
        },
      }),
    );
  });

  it.each([
    {field: undefined, source: 'steps.build.outputs.sha'},
    {field: 'env.SHA', source: undefined},
  ])('uses generic configuration copy when $field or $source is absent', async (errorFields) => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      error: {
        reason: 'config_unresolvable',
        message: 'Internal definition and evaluation details',
        ...errorFields,
      },
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**A value in this step has an error**',
            '',
            'Shipfox cannot compute a value in this step. Fix the expression, then start a new run.',
          ].join('\n'),
        },
      }),
    );
  });

  it('uses provider exhaustion copy without exposing the raw provider phrase', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      error: {
        reason: 'agent_invocation_failed',
        code: 'provider_stream_interrupted',
        message: 'Stream error occurred',
        attemptCount: 4,
        maxAttempts: 4,
      },
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: expect.stringContaining(
            'The connection to the model provider dropped during the response. Shipfox tried 4 times. Rerun the failed jobs.',
          ),
        },
      }),
    );
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: expect.objectContaining({
          body: expect.stringContaining('Stream error occurred'),
        }),
      }),
    );
  });

  it('includes bounded size details in a size-failure annotation', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      status: 'failed',
      error: {
        reason: 'step_result_too_large',
        message: 'bounded failure',
        measuredBytes: 12_345,
        limitBytes: 8_192,
      },
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**The step result is too large**',
            '',
            'Make the values this step returns smaller. Then start a new run.',
            '',
            'Measured 12345 bytes; limit 8192 bytes.',
          ].join('\n'),
        },
      }),
    );
  });

  it.each(STEP_FAILURE_CASES)('uses safe exact copy for $reason', async (failureCase) => {
    const {reason, type, title, description} = failureCase;
    const gateResult = 'gateResult' in failureCase ? failureCase.gateResult : null;
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type,
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {reason, message: 'internal runtime detail'},
      exitCode: 73,
      gateResult,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [`**${title}**`, '', description].join('\n'),
        },
      }),
    );
  });

  it('explains validation after a successful Slack call without exposing internals', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
      error: {kind: 'gate_uncheckable', message: 'step produced no exit code'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      exitCode: null,
      error: {kind: 'gate_uncheckable', message: 'step produced no exit code'},
      gateResult: {
        passed: false,
        uncheckable: true,
        reason: 'step produced no exit code',
        exit_code: null,
      },
      invocations: [successfulToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**The success condition failed**',
            '',
            'The Slack call worked, but Shipfox cannot evaluate the success condition. Your workflow has no error. Rerun the job.',
          ].join('\n'),
        },
      }),
    );
  });

  it('identifies a successful Slack call before a gate expression error', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {kind: 'gate_uncheckable', message: 'gate expression evaluation failed'},
      exitCode: null,
      gateResult: {
        passed: false,
        uncheckable: true,
        reason: 'gate expression evaluation failed',
        exit_code: null,
      },
      invocations: [successfulToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**The success condition failed**',
            '',
            'The Slack call worked, but Shipfox cannot evaluate the success condition. Check the condition and the values it uses.',
          ].join('\n'),
        },
      }),
    );
  });

  it('identifies a successful Slack call before a rejected gate', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {kind: 'gate_failed', message: 'gate condition not met'},
      exitCode: null,
      gateResult: {passed: false, source: 'output.ok', exit_code: null},
      invocations: [successfulToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**The success condition failed**',
            '',
            'The Slack call worked, but the success condition is false. Check the result and the condition.',
          ].join('\n'),
        },
      }),
    );
  });

  it('identifies a successful Slack call before invalid output mapping', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {reason: 'output_invalid', message: 'output path exposed an internal value'},
      exitCode: null,
      invocations: [successfulToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**The tool call worked, but the step failed**',
            '',
            'The Slack call worked, but Shipfox cannot save its result as step output. Check the declared outputs.',
          ].join('\n'),
        },
      }),
    );
  });

  it('does not present a failed Slack call as a gate failure', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'slack', sensitivity: 'read'}},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {kind: 'gate_failed', message: 'gate condition not met'},
      exitCode: null,
      gateResult: {passed: false, source: 'output.ok', exit_code: null},
      invocations: [failedToolInvocation()],
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**The integration returned an error**',
            '',
            'Read the error in the step details. Fix the cause, then rerun the job.',
          ].join('\n'),
        },
      }),
    );
  });

  it('uses safe fallback copy instead of an unknown error payload', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      error: {kind: 'unexpected_internal_failure', message: 'database host api-1 failed'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {kind: 'unexpected_internal_failure', message: 'database host api-1 failed'},
      exitCode: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**The step failed**',
            '',
            'Read the step logs for the cause. Then rerun the job.',
          ].join('\n'),
        },
      }),
    );
  });

  it('warns before retrying an interrupted write tool without exposing its error', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'tool',
      config: {tool: {provider: 'github', sensitivity: 'write'}},
      error: {reason: 'invocation_interrupted', message: 'request stream closed at byte 391'},
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {reason: 'invocation_interrupted', message: 'request stream closed at byte 391'},
      exitCode: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            '**The tool call stopped before it finished**',
            '',
            'The change may already exist. Check the integration before you rerun the job.',
          ].join('\n'),
        },
      }),
    );
  });

  it.each(
    AGENT_CONFIG_FAILURE_CASES,
  )('explains persisted agent configuration issue $issue', async ({issue, title, description}) => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      type: 'agent',
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      error: {
        reason: 'agent_config_invalid',
        agentConfigIssue: issue,
        message: 'provider lookup returned an internal configuration detail',
      },
      exitCode: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [`**${title}**`, '', description].join('\n'),
        },
      }),
    );
  });

  it('removes a stale step failure annotation after a successful terminal event', async () => {
    const payload = stepAttemptTerminatedPayload({attempt: 2, status: 'succeeded'});
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      attempt: 2,
      status: 'succeeded',
      exitCode: 0,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:step:${payload.stepId}`,
        annotation: {op: 'remove'},
      }),
    );
  });

  it('does not resurrect a failure when an older failed event arrives after recovery', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const attempt = stepAttemptEntity({
      stepId: step.id,
      attempt: 1,
      status: 'failed',
      exitCode: 1,
      error: {reason: 'agent_invocation_failed', message: 'old failure'},
    });
    const recoveredStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'succeeded',
      currentAttempt: 2,
      error: null,
    });
    const recoveredAttempt = stepAttemptEntity({
      stepId: recoveredStep.id,
      attempt: 2,
      status: 'succeeded',
      exitCode: 0,
      error: null,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: recoveredStep,
      attempt: recoveredAttempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:step:${payload.stepId}`,
        annotation: {op: 'remove'},
      }),
    );
  });

  it('projects the canonical current attempt when an older failure event arrives late', async () => {
    const payload = stepAttemptTerminatedPayload();
    const oldStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      currentAttempt: 2,
      error: {reason: 'agent_invocation_failed', message: 'old step error'},
    });
    const oldAttempt = stepAttemptEntity({
      stepId: oldStep.id,
      attempt: 1,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'old failure'},
    });
    const currentStep = stepEntity({
      id: payload.stepId,
      jobExecutionId: JOB_EXECUTION_ID,
      status: 'failed',
      currentAttempt: 2,
      error: {reason: 'agent_invocation_failed', message: 'current step error'},
    });
    const currentAttempt = stepAttemptEntity({
      stepId: currentStep.id,
      attempt: 2,
      status: 'failed',
      error: {reason: 'agent_invocation_failed', message: 'current failure'},
      exitCode: 2,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: oldStep,
      attempt: oldAttempt,
    });
    dbMocks.getStepAttemptDetail.mockResolvedValueOnce({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step: currentStep,
      attempt: currentAttempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        originStepAttempt: 2,
        annotation: expect.objectContaining({
          op: 'replace',
          body: expect.stringContaining('The agent failed'),
        }),
      }),
    );
  });

  it('skips first successful attempts without reading projection history', async () => {
    const payload = stepAttemptTerminatedPayload({status: 'succeeded'});

    await onStepAttemptTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getStepAttemptDetail).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it.each(JOB_FAILURE_CASES)('uses safe exact job copy for $reason', async ({
    reason,
    title,
    description,
  }) => {
    const payload = jobTerminatedPayload({
      status: reason === 'condition_errored' ? 'skipped' : 'failed',
      statusReason: reason,
      statusReasonMessage: 'internal scheduler detail with host and process information',
    });
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'failed',
      stepAttempt: 2,
      stepError: {reason: 'agent_invocation_failed', message: 'internal step detail'},
      attemptStatus: 'failed',
      attemptError: {reason: 'agent_invocation_failed', message: 'internal attempt detail'},
      attemptExitCode: 73,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: {
          op: 'replace',
          style: 'error',
          body: [
            `**${title}**`,
            '',
            'The job stopped while processing **Run tests**.',
            '',
            description,
          ].join('\n'),
        },
      }),
    );
  });

  it('projects a job failure from the current execution origin', async () => {
    const payload = jobTerminatedPayload({
      status: 'failed',
      statusReason: 'output_too_large',
      statusReasonMessage:
        'Job output "payload" exceeds the per-value size limit of 16384 bytes (measured 16385 bytes; overshoot 1 bytes).',
    });
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'failed',
      stepAttempt: 2,
      stepError: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
      attemptStatus: 'failed',
      attemptError: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
      attemptExitCode: 1,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobExecutionFailureOrigin).toHaveBeenCalledWith(payload.jobExecutionId);
    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        jobExecutionId: payload.jobExecutionId,
        originStepId: '77777777-7777-4777-8777-777777777777',
        originStepAttempt: 2,
        context: `failure:job:${payload.jobId}`,
        annotation: expect.objectContaining({
          op: 'replace',
          body: expect.stringContaining('Run tests'),
        }),
      }),
    );
    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: expect.objectContaining({
          body: [
            '**The job output is too large**',
            '',
            'The job stopped while processing **Run tests**.',
            '',
            'Make the job outputs smaller, or write large data to a file. Then start a new run.',
          ].join('\n'),
        }),
      }),
    );
  });

  it('explains an invalid job output without exposing its status message', async () => {
    const payload = jobTerminatedPayload({
      statusReason: 'output_invalid',
      statusReasonMessage: 'Job output "payload" cannot be persisted as JSON: undefined.',
    });
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'succeeded',
      stepAttempt: 1,
      stepError: null,
      attemptStatus: 'succeeded',
      attemptError: null,
      attemptExitCode: 0,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: expect.objectContaining({
          body: [
            '**Shipfox cannot save the job output**',
            '',
            'The job stopped while processing **Run tests**.',
            '',
            'Every job output must be a valid JSON value. Fix the job outputs, then start a new run.',
          ].join('\n'),
        }),
      }),
    );
  });

  it('projects a condition evaluation error from a skipped job', async () => {
    const payload = jobTerminatedPayload({status: 'skipped', statusReason: 'condition_errored'});
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 3});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Run tests',
      stepStatus: 'skipped',
      stepAttempt: 1,
      stepError: null,
      attemptStatus: null,
      attemptError: null,
      attemptExitCode: null,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        context: `failure:job:${payload.jobId}`,
        annotation: expect.objectContaining({op: 'replace', style: 'error'}),
      }),
    );
  });

  it('uses the first step as the origin when a job fails before any attempt starts', async () => {
    const payload = jobTerminatedPayload({status: 'failed'});
    dbMocks.getJobScope.mockResolvedValue({
      workspaceId: '44444444-4444-4444-8444-444444444444',
      projectId: '55555555-5555-4555-8555-555555555555',
      triggerReference: null,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    dbMocks.getJobExecutionFailureOrigin.mockResolvedValue({
      jobExecutionId: payload.jobExecutionId,
      stepId: '77777777-7777-4777-8777-777777777777',
      stepName: 'Checkout',
      stepStatus: 'pending',
      stepAttempt: 1,
      stepError: null,
      attemptStatus: null,
      attemptError: null,
      attemptExitCode: null,
    });

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(replaceOrRemoveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({
        originStepId: '77777777-7777-4777-8777-777777777777',
        originStepAttempt: 1,
        annotation: expect.objectContaining({
          body: expect.stringContaining('before **Checkout** started'),
        }),
      }),
    );
  });

  it('does not guess an execution for legacy terminal events without an execution id', async () => {
    const payload = jobTerminatedPayload({jobExecutionId: undefined});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('does not project a duplicate job card for a step failure', async () => {
    const payload = jobTerminatedPayload({statusReason: 'step_failed'});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobScope).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('skips successful jobs without reading projection history', async () => {
    const payload = jobTerminatedPayload({status: 'succeeded', statusReason: null});

    await onJobTerminatedFailureAnnotation(annotations)(payload);

    expect(dbMocks.getJobScope).not.toHaveBeenCalled();
    expect(dbMocks.getWorkflowRunAttemptById).not.toHaveBeenCalled();
    expect(dbMocks.getJobExecutionFailureOrigin).not.toHaveBeenCalled();
    expect(replaceOrRemoveAnnotation).not.toHaveBeenCalled();
  });

  it('records and logs lookup failures without changing the terminal outcome', async () => {
    const error = new Error('database unavailable');
    dbMocks.getStepAttemptDetail.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(stepAttemptTerminatedPayload()),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('lookup');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'lookup'}),
      'Failed to project workflow failure annotation',
    );
  });

  it('records and logs annotation write failures without throwing', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({id: payload.stepId, jobExecutionId: JOB_EXECUTION_ID});
    const attempt = stepAttemptEntity({stepId: step.id});
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    const error = new Error('annotation service unavailable');
    replaceOrRemoveAnnotation.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(payload),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('write');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'write'}),
      'Failed to project workflow failure annotation',
    );
  });

  it('classifies published annotation budget failures separately from write failures', async () => {
    const payload = stepAttemptTerminatedPayload();
    const step = stepEntity({id: payload.stepId, jobExecutionId: JOB_EXECUTION_ID});
    const attempt = stepAttemptEntity({stepId: step.id});
    dbMocks.getStepAttemptDetail.mockResolvedValue({
      workflowRunId: payload.workflowRunId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      step,
      attempt,
    });
    dbMocks.getWorkflowRunAttemptById.mockResolvedValue({attempt: 1});
    const error = createInterModuleKnownError(
      annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
      'annotation-count-limit-exceeded',
      {maxAnnotations: 10},
    );
    replaceOrRemoveAnnotation.mockRejectedValueOnce(error);

    await expect(
      onStepAttemptTerminatedFailureAnnotation(annotations)(payload),
    ).resolves.toBeUndefined();

    expect(metricMocks.recordWorkflowFailureAnnotationFailed).toHaveBeenCalledWith('budget');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({error, reason: 'budget'}),
      'Failed to project workflow failure annotation',
    );
  });
});

function stepAttemptTerminatedPayload(
  overrides: Partial<WorkflowsStepAttemptTerminatedEventDto> = {},
): WorkflowsStepAttemptTerminatedEventDto {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    workflowRunId: '22222222-2222-4222-8222-222222222222',
    workflowRunAttemptId: '33333333-3333-4333-8333-333333333333',
    workspaceId: '44444444-4444-4444-8444-444444444444',
    projectId: '55555555-5555-4555-8555-555555555555',
    stepId: '77777777-7777-4777-8777-777777777777',
    attempt: 1,
    status: 'failed',
    logOutcome: 'drained',
    ...overrides,
  };
}

function jobTerminatedPayload(
  overrides: Partial<WorkflowsJobTerminatedEventDto> = {},
): WorkflowsJobTerminatedEventDto {
  return {
    jobId: '11111111-1111-4111-8111-111111111111',
    jobExecutionId: JOB_EXECUTION_ID,
    workflowRunId: '22222222-2222-4222-8222-222222222222',
    workflowRunAttemptId: '33333333-3333-4333-8333-333333333333',
    status: 'failed',
    statusReason: 'timed_out',
    ...overrides,
  };
}

function stepEntity(overrides: Partial<Step> = {}): Step {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    jobExecutionId: JOB_EXECUTION_ID,
    key: 'run',
    name: 'Run tests',
    sourceLocation: null,
    status: 'failed',
    statusReason: null,
    evaluationTrace: null,
    type: 'run',
    config: {run: 'pnpm test'},
    condition: null,
    runAfter: 'success',
    configPlan: null,
    authoredConfig: {run: 'pnpm test'},
    error: {reason: 'agent_invocation_failed', message: 'Provider returned 500'},
    position: 1,
    version: 1,
    currentAttempt: 1,
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    updatedAt: new Date('2026-08-05T12:00:00.000Z'),
    ...overrides,
  };
}

function stepAttemptEntity(overrides: Partial<StepAttempt> = {}): StepAttempt {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    stepId: '77777777-7777-4777-8777-777777777777',
    attempt: 1,
    executionOrder: 1,
    status: 'failed',
    config: {run: 'pnpm test'},
    evaluationTrace: null,
    output: null,
    response: null,
    error: null,
    exitCode: 1,
    logPath: null,
    gateResult: null,
    restartFeedback: null,
    logOutcome: 'drained',
    invocations: [],
    startedAt: new Date('2026-08-05T12:00:00.000Z'),
    finishedAt: new Date('2026-08-05T12:01:00.000Z'),
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    ...overrides,
  };
}

function successfulToolInvocation(): StepAttempt['invocations'][number] {
  return {
    call_index: 0,
    started_at: '2026-09-02T07:25:28.000Z',
    finished_at: '2026-09-02T07:25:28.879Z',
    outcome: 'success',
  };
}

function failedToolInvocation(): StepAttempt['invocations'][number] {
  return {
    call_index: 0,
    started_at: '2026-09-02T07:25:28.000Z',
    finished_at: '2026-09-02T07:25:28.879Z',
    outcome: 'error',
    error_code: 'provider_error',
  };
}
