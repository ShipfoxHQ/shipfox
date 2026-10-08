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
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {logger} from '@shipfox/node-opentelemetry';
import type {JobStatusReason} from '#core/entities/job.js';
import type {StepAttempt} from '#core/entities/step.js';
import {GATE_EVALUATION_ERROR_REASON} from '#core/step-transition/evaluate-gate.js';
import {
  getJobExecutionFailureOrigin,
  getJobScope,
  getStepAttemptDetail,
  getWorkflowRunAttemptById,
} from '#db/index.js';
import type {StepAttemptDetailStep} from '#db/workflow-runs/steps.js';
import {recordWorkflowFailureAnnotationFailed} from '#metrics/instance.js';

const JOB_FAILURE_ANNOTATION_REASONS = new Set([
  'timed_out',
  'lease_expired',
  'provider_lost',
  'lifecycle_violation',
  'runner_lost',
  'condition_errored',
  'output_too_large',
  'output_invalid',
]);

interface FailureCopy {
  readonly title: string;
  readonly description: string;
}

const STEP_FAILURE_COPY: Readonly<
  Record<
    Exclude<StepErrorReasonDto, 'agent_config_invalid' | 'invocation_interrupted'>,
    FailureCopy
  >
> = {
  checkout_failed: {
    title: 'Checkout failed',
    description:
      'Read the Git output in the step logs to find the cause. Then check the repository and ref of the checkout.',
  },
  checkout_auth_failed: {
    title: 'The repository rejected the checkout',
    description:
      'Check that the integration connection can read this repository. Then rerun the job.',
  },
  checkout_unavailable: {
    title: 'The runner cannot reach the repository',
    description: 'Rerun the job. If it fails again, check the network access of the runner.',
  },
  checkout_path_invalid: {
    title: 'The checkout path is not valid',
    description:
      'Use a relative path inside the job folder, without `..` or `.git`. Then start a new run.',
  },
  checkout_destination_occupied: {
    title: 'The checkout folder is not empty',
    description:
      'Choose an empty folder, or set `force` to replace its content. Then start a new run.',
  },
  git_unavailable: {
    title: 'The runner cannot start Git',
    description: 'Install Git in the runner image. Then rerun the job.',
  },
  workspace_prep_failed: {
    title: 'The runner cannot prepare the job',
    description: 'Read the setup logs for the cause. Then rerun the job.',
  },
  container_setup_failed: {
    title: 'The job container did not start',
    description:
      'Read the setup logs for the Docker error. Check the image name and registry credentials, then rerun the job.',
  },
  setup_aborted: {
    title: 'The job stopped during setup',
    description:
      'A user cancelled the job, or it reached its timeout, before setup finished. Rerun the job.',
  },
  config_unresolvable: {
    title: 'A value in this step has an error',
    description:
      'Shipfox cannot compute a value in this step. Fix the expression, then start a new run.',
  },
  output_invalid: {
    title: 'The step output has the wrong shape',
    description:
      'The step output does not match the declared outputs. Fix the step or the declaration, then start a new run.',
  },
  diagnostic_too_large: {
    title: 'The step details are too large',
    description: 'Make the step write less data. Then start a new run.',
  },
  execution_payload_too_large: {
    title: 'The step input is too large',
    description: 'Make the values this step uses smaller. Then start a new run.',
  },
  step_result_too_large: {
    title: 'The step result is too large',
    description: 'Make the values this step returns smaller. Then start a new run.',
  },
  agent_invocation_failed: {
    title: 'The agent failed',
    description: 'The agent stopped with an error. Read the step logs for the cause.',
  },
  agent_harness_unavailable: {
    title: 'The agent cannot start',
    description: 'The runner cannot start the agent. Rerun the job.',
  },
  agent_inference_credentials_unavailable: {
    title: 'Shipfox cannot reach the model provider',
    description: 'Rerun the job. If it fails again, check the model provider in Agents settings.',
  },
  agent_session_key_invalid: {
    title: 'The session name is not valid',
    description:
      'Start the session name with a letter or digit. Use only letters, digits, dots, underscores, or hyphens.',
  },
  agent_session_held: {
    title: 'Another step is using this session',
    description:
      'Two steps that run at the same time cannot continue one session. Give each step its own session.',
  },
  agent_session_harness_mismatch: {
    title: 'This session uses another harness',
    description:
      'A session works with one harness only. Use the harness of the first step, or use a new session.',
  },
  agent_session_unavailable: {
    title: 'Shipfox cannot load the session',
    description: 'Rerun the failed jobs. If it fails again, use a new session.',
  },
  tool_error: {
    title: 'The integration returned an error',
    description: 'Read the error in the step details. Fix the cause, then rerun the job.',
  },
  tool_config_invalid: {
    title: 'A tool input is not valid',
    description: 'Fix the tool input in the step, then start a new run.',
  },
  action_input_invalid: {
    title: 'An action input is not valid',
    description:
      'A `with` value does not match the input in `action.yml`. Fix the value or the input, then start a new run.',
  },
  action_unavailable: {
    title: 'The runner cannot load the action',
    description: 'Rerun the job. If it fails again, contact your workspace admin.',
  },
  gate_failed: {
    title: 'The success condition failed',
    description:
      'The step finished, but its success condition is false. Fix the step or the condition, then start a new run.',
  },
  gate_uncheckable: {
    title: 'The success condition failed',
    description:
      'Shipfox cannot evaluate the success condition. Fix the condition or the values it uses, then start a new run.',
  },
  restart_unresolved: {
    title: 'The restart step does not exist',
    description:
      'Shipfox cannot find the step in `gate.on_failure.restart_from`. Fix it, then start a new run.',
  },
  restart_exhausted: {
    title: 'The step reached its attempt limit',
    description: 'Fix the cause, or raise `gate.on_failure.max_attempts`. Then start a new run.',
  },
};

const UNKNOWN_STEP_FAILURE_COPY: FailureCopy = {
  title: 'The step failed',
  description: 'Read the step logs for the cause. Then rerun the job.',
};

// Causes the checkout-token route names. Copy states a cause only when the code
// establishes it: `access-denied` and `provider-rejected` cover several causes, so
// they show the provider's explanation instead.
const CHECKOUT_CAUSE_COPY: Readonly<Record<string, FailureCopy>> = {
  'repository-not-granted': {
    title: 'Shipfox is not allowed to check out this repository',
    description:
      'Link a project to the repository, or let the connection use all repositories. Then rerun the job.',
  },
  'checkout-repository-not-authorized': {
    title: 'Shipfox is not allowed to check out this repository',
    description: 'Use a project of this workspace in `checkout.project`. Then start a new run.',
  },
  'installation-inactive': {
    title: 'The GitHub App installation is suspended or removed',
    description: 'Unsuspend or reinstall the Shipfox GitHub App. Then rerun the job.',
  },
  'repository-not-found': {
    title: 'The provider cannot find the repository',
    description:
      'Check the repository name, and that the connection includes the repository. Then rerun the job.',
  },
  'access-denied': {
    title: 'The provider denied access to the repository',
    description: 'Check the permissions and the repository access of the connection.',
  },
  'provider-rejected': {
    title: 'The provider rejected the checkout request',
    description: 'Read the step logs for the request that failed.',
  },
  'integration-connection-inactive': {
    title: 'The checkout connection is disabled',
    description: 'Enable the connection in the integration settings. Then rerun the job.',
  },
  'checkout-unavailable': {
    title: 'The checkout connection or project does not exist',
    description:
      'Fix `checkout.connection` or `checkout.project` in the workflow. Then start a new run.',
  },
};

const CHECKOUT_CAUSE_REASONS = new Set(['checkout_failed', 'checkout_auth_failed']);

const AGENT_CONFIG_FAILURE_COPY: Readonly<Record<AgentConfigIssueDto, FailureCopy>> = {
  step_config_invalid: {
    title: 'Complete the agent step',
    description:
      'An agent step needs a prompt, a provider, a model, and a thinking level. Add the missing values, then start a new run.',
  },
  provider_not_configured: {
    title: 'Connect the model provider',
    description:
      'Your workspace has no credentials for the provider of this step. Add them in Agents settings, then rerun the job.',
  },
  provider_unsupported: {
    title: 'Choose another model provider',
    description:
      'The harness of this step cannot use its provider. Change the provider or the harness, then start a new run.',
  },
  model_unavailable: {
    title: 'Choose another model',
    description:
      'The model of this step is not available in this workspace. Change the model, then start a new run.',
  },
  credentials_invalid: {
    title: 'Update the model provider credentials',
    description:
      'The model provider rejected the saved credentials. Update them in Agents settings, then rerun the job.',
  },
};

const JOB_FAILURE_COPY: Readonly<Partial<Record<JobStatusReason, FailureCopy>>> = {
  timed_out: {
    title: 'The job took too long',
    description:
      'The job did not finish before its timeout. Raise the timeout or make the job faster. Then start a new run.',
  },
  runner_lost: {
    title: 'The runner stopped responding',
    description: 'Rerun the job. If it fails again, contact your workspace admin.',
  },
  condition_errored: {
    title: 'The job condition has an error',
    description: 'Shipfox cannot evaluate the `if` condition. Fix it, then start a new run.',
  },
  output_too_large: {
    title: 'The job output is too large',
    description:
      'Make the job outputs smaller, or write large data to a file. Then start a new run.',
  },
  output_invalid: {
    title: 'Shipfox cannot save the job output',
    description:
      'Every job output must be a valid JSON value. Fix the job outputs, then start a new run.',
  },
};

const RUNNER_LOSS_COPY_REASONS = new Set<JobStatusReason>([
  'lease_expired',
  'provider_lost',
  'lifecycle_violation',
]);

const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  gitea: 'Gitea',
  github: 'GitHub',
  jira: 'Jira',
  clickup: 'ClickUp',
  discord: 'Discord',
  linear: 'Linear',
  notion: 'Notion',
  sentry: 'Sentry',
  slack: 'Slack',
};

export function onStepAttemptTerminatedFailureAnnotation(
  annotations: AnnotationsInterModuleClient,
) {
  return async (payload: WorkflowsStepAttemptTerminatedEventDto): Promise<void> => {
    // A first successful/cancelled attempt cannot have a stale failure annotation.
    // Keep later terminal attempts on the lookup path so recovery removes the
    // annotation created by an earlier failed attempt.
    if (payload.status !== undefined && payload.status !== 'failed' && payload.attempt === 1) {
      return;
    }

    try {
      const detail = await getCurrentStepAttemptDetail(payload);
      if (!detail || detail.attempt.attempt !== detail.step.currentAttempt) return;

      const runAttempt = await getWorkflowRunAttemptById(payload.workflowRunAttemptId);
      if (!runAttempt) return;

      await writeFailureAnnotation({
        annotations,
        target: {
          workspaceId: payload.workspaceId,
          projectId: payload.projectId,
          workflowRunId: payload.workflowRunId,
          workflowRunAttempt: runAttempt.attempt,
          workflowRunAttemptId: payload.workflowRunAttemptId,
          jobId: payload.jobId,
          jobExecutionId: detail.step.jobExecutionId,
          originStepId: detail.step.id,
          originStepAttempt: detail.attempt.attempt,
        },
        context: failureContext('step', detail.step.id),
        failed: currentStepAttemptFailed(detail),
        body: stepFailureBody(detail.step, detail.attempt),
      });
    } catch (error) {
      recordFailureAnnotationFailure(error, 'lookup', {
        stepId: payload.stepId,
        jobId: payload.jobId,
      });
    }
  };
}

async function getCurrentStepAttemptDetail(payload: WorkflowsStepAttemptTerminatedEventDto) {
  const initialDetail = await getStepAttemptDetail({
    stepId: payload.stepId,
    attempt: payload.attempt,
  });
  if (!initialDetail) return undefined;

  // The detail query joins the requested attempt to the step's current projection. A
  // delayed event can therefore return an old attempt alongside a newer step status. Read
  // the canonical current attempt before deciding whether to replace or remove the card.
  if (initialDetail.attempt.attempt === initialDetail.step.currentAttempt) return initialDetail;
  return getStepAttemptDetail({
    stepId: initialDetail.step.id,
    attempt: initialDetail.step.currentAttempt,
  });
}

function currentStepAttemptFailed(
  detail: NonNullable<Awaited<ReturnType<typeof getStepAttemptDetail>>>,
): boolean {
  if (detail.step.status === 'failed') return true;
  if (detail.attempt.status !== 'failed') return false;
  return detail.step.status !== 'succeeded' && detail.step.status !== 'cancelled';
}

export function onJobTerminatedFailureAnnotation(annotations: AnnotationsInterModuleClient) {
  return async (payload: WorkflowsJobTerminatedEventDto): Promise<void> => {
    // Step failures already have a step-scoped annotation. Job-scoped annotations
    // are reserved for terminal causes where no step-level failure card exists.
    const isConditionEvaluationFailure =
      payload.status === 'skipped' && payload.statusReason === 'condition_errored';
    if (
      (payload.status !== 'failed' && !isConditionEvaluationFailure) ||
      !JOB_FAILURE_ANNOTATION_REASONS.has(payload.statusReason ?? '')
    ) {
      return;
    }

    try {
      const [scope, runAttempt] = await Promise.all([
        getJobScope(payload.jobId),
        getWorkflowRunAttemptById(payload.workflowRunAttemptId),
      ]);
      if (!scope || !runAttempt || !payload.jobExecutionId) return;

      const origin = await getJobExecutionFailureOrigin(payload.jobExecutionId);
      if (!origin) return;

      await writeFailureAnnotation({
        annotations,
        target: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          workflowRunId: payload.workflowRunId,
          workflowRunAttempt: runAttempt.attempt,
          workflowRunAttemptId: payload.workflowRunAttemptId,
          jobId: payload.jobId,
          jobExecutionId: origin.jobExecutionId,
          originStepId: origin.stepId,
          originStepAttempt: origin.stepAttempt,
        },
        context: failureContext('job', payload.jobId),
        failed: true,
        body: jobFailureBody(payload.statusReason, origin),
      });
    } catch (error) {
      recordFailureAnnotationFailure(error, 'lookup', {jobId: payload.jobId});
    }
  };
}

type FailureAnnotationTarget = {
  workspaceId: string;
  projectId: string;
  workflowRunId: string;
  workflowRunAttempt: number;
  workflowRunAttemptId: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
};

/**
 * Failure annotations are a best-effort projection. The workflow terminal fact is authoritative;
 * projection lookup and writes are swallowed so they cannot change the workflow outcome. Every
 * swallowed error emits a reason-labelled metric and a structured warning for operations.
 */
async function writeFailureAnnotation(params: {
  annotations: AnnotationsInterModuleClient;
  target: FailureAnnotationTarget;
  context: string;
  failed: boolean;
  body: string;
}): Promise<void> {
  try {
    await params.annotations.replaceOrRemoveAnnotation({
      ...params.target,
      context: params.context,
      annotation: params.failed
        ? {op: 'replace', style: 'error', body: params.body}
        : {op: 'remove'},
    });
  } catch (error) {
    const reason = isInterModuleKnownError(
      annotationsInterModuleContract.methods.replaceOrRemoveAnnotation,
      error,
    )
      ? 'budget'
      : 'write';
    recordFailureAnnotationFailure(error, reason, params.target);
  }
}

function failureContext(kind: 'job' | 'step', id: string): string {
  return `failure:${kind}:${id}`;
}

function stepFailureBody(step: StepAttemptDetailStep, attempt: StepAttempt): string {
  const copy = stepFailureCopy(step, attempt);
  const details = stepFailureSizeDetails(attempt.error ?? step.error);
  return [
    `**${copy.title}**`,
    '',
    copy.description,
    ...(details === undefined ? [] : ['', details]),
  ].join('\n');
}

function stepFailureSizeDetails(error: Record<string, unknown> | null): string | undefined {
  if (!error) return undefined;
  const measuredBytes = error.measuredBytes;
  const limitBytes = error.limitBytes;
  if (
    typeof measuredBytes !== 'number' ||
    !Number.isFinite(measuredBytes) ||
    typeof limitBytes !== 'number' ||
    !Number.isFinite(limitBytes)
  ) {
    return undefined;
  }
  return `Measured ${measuredBytes} bytes; limit ${limitBytes} bytes.`;
}

function jobFailureBody(
  reason: JobStatusReason | null,
  origin: {
    stepName: string;
    attemptStatus: string | null;
  },
): string {
  const progress = origin.attemptStatus
    ? `The job stopped while processing **${origin.stepName}**.`
    : `The job stopped before **${origin.stepName}** started.`;
  const copyReason =
    reason !== null && RUNNER_LOSS_COPY_REASONS.has(reason) ? 'runner_lost' : reason;
  const copy =
    (copyReason === null ? undefined : JOB_FAILURE_COPY[copyReason]) ??
    ({
      title: 'The job failed',
      description: 'Rerun the job. If it fails again, contact your workspace admin.',
    } satisfies FailureCopy);
  return [`**${copy.title}**`, '', progress, '', copy.description].join('\n');
}

function stepFailureCopy(step: StepAttemptDetailStep, attempt: StepAttempt): FailureCopy {
  const error = attempt.error ?? step.error;
  const providerFailure = providerStreamFailureCopy(error);
  if (providerFailure !== undefined) return providerFailure;

  const reason = errorReason(error);
  const checkoutCause = checkoutCauseFailureCopy(error, reason);
  if (checkoutCause !== undefined) return checkoutCause;

  const configFailure = configUnresolvableFailureCopy(error, reason);
  if (configFailure !== undefined) return configFailure;

  const toolFailure = toolStepFailureCopy(step, attempt, error, reason);
  if (toolFailure !== undefined) return toolFailure;

  if (reason === 'restart_unresolved' || reason === 'restart_exhausted') {
    return knownStepFailureCopy(reason);
  }

  const gateFailure = gateFailureCopy(attempt, reason);
  if (gateFailure !== undefined) return gateFailure;

  if (reason === 'agent_config_invalid') return agentConfigFailureCopy(error);
  if (reason === 'invocation_interrupted') return interruptedToolFailureCopy(step);

  return knownStepFailureCopy(reason);
}

function checkoutCauseFailureCopy(
  error: Record<string, unknown> | null,
  reason: string | undefined,
): FailureCopy | undefined {
  if (reason === undefined || !CHECKOUT_CAUSE_REASONS.has(reason)) return undefined;
  const code = errorString(error, 'code');
  const copy = code === undefined ? undefined : CHECKOUT_CAUSE_COPY[code];
  if (copy === undefined) return undefined;

  const message = errorString(error, 'message');
  const providerMessage = errorString(error, 'providerMessage');
  return {
    title: copy.title,
    description: [
      ...(message === undefined ? [] : [message.endsWith('.') ? message : `${message}.`]),
      ...(providerMessage === undefined ? [] : ['The provider said:', codeBlock(providerMessage)]),
      copy.description,
    ].join('\n\n'),
  };
}

// The provider's text is untrusted, so it is shown as inert code.
function codeBlock(text: string): string {
  return ['```text', text.replaceAll('```', "'''"), '```'].join('\n');
}

function configUnresolvableFailureCopy(
  error: Record<string, unknown> | null,
  reason: string | undefined,
): FailureCopy | undefined {
  if (reason !== 'config_unresolvable') return undefined;

  const field = errorString(error, 'field');
  const source = errorString(error, 'source');
  if (field === undefined || source === undefined) return undefined;

  return {
    title: 'A value in this step has an error',
    description: `\`${field}\` uses \`${source}\`, but that value does not exist. Fix it, then start a new run.`,
  };
}

function toolStepFailureCopy(
  step: StepAttemptDetailStep,
  attempt: StepAttempt,
  error: Record<string, unknown> | null,
  reason: string | undefined,
): FailureCopy | undefined {
  if (step.type !== 'tool') return undefined;
  if (successfulToolCall(attempt)) {
    return successfulToolFailureCopy(step, attempt, error, reason);
  }
  return reason === 'gate_failed' || gateConditionFailed(attempt)
    ? STEP_FAILURE_COPY.tool_error
    : undefined;
}

function successfulToolFailureCopy(
  step: StepAttemptDetailStep,
  attempt: StepAttempt,
  error: Record<string, unknown> | null,
  reason: string | undefined,
): FailureCopy | undefined {
  if (gateCouldNotUseToolResult(attempt, error)) {
    return {
      title: 'The success condition failed',
      description: `The ${toolCallName(step)} worked, but Shipfox cannot evaluate the success condition. Your workflow has no error. Rerun the job.`,
    };
  }

  if (gateEvaluationFailed(attempt)) {
    return {
      title: 'The success condition failed',
      description: `The ${toolCallName(step)} worked, but Shipfox cannot evaluate the success condition. Check the condition and the values it uses.`,
    };
  }

  if (reason === 'gate_failed' || gateConditionFailed(attempt)) {
    return {
      title: 'The success condition failed',
      description: `The ${toolCallName(step)} worked, but the success condition is false. Check the result and the condition.`,
    };
  }

  if (reason === 'output_invalid') {
    return {
      title: 'The tool call worked, but the step failed',
      description: `The ${toolCallName(step)} worked, but Shipfox cannot save its result as step output. Check the declared outputs.`,
    };
  }

  return undefined;
}

function gateFailureCopy(
  attempt: StepAttempt,
  reason: string | undefined,
): FailureCopy | undefined {
  if (reason === 'gate_failed' || gateConditionFailed(attempt)) {
    return STEP_FAILURE_COPY.gate_failed;
  }

  return reason === 'gate_uncheckable' ? STEP_FAILURE_COPY.gate_uncheckable : undefined;
}

function agentConfigFailureCopy(error: Record<string, unknown> | null): FailureCopy {
  const fallback = {
    title: 'Check the agent step',
    description:
      'Shipfox cannot read the settings of this agent step. Check the step in the workflow file, then start a new run.',
  } satisfies FailureCopy;
  const issue = errorString(error, 'agentConfigIssue');
  return issue === undefined
    ? fallback
    : (AGENT_CONFIG_FAILURE_COPY[issue as AgentConfigIssueDto] ?? fallback);
}

function interruptedToolFailureCopy(step: StepAttemptDetailStep): FailureCopy {
  return toolSensitivity(step) === 'write'
    ? {
        title: 'The tool call stopped before it finished',
        description:
          'The change may already exist. Check the integration before you rerun the job.',
      }
    : {
        title: 'The tool call stopped before it finished',
        description: 'Shipfox does not know the result of the call. Rerun the job.',
      };
}

function providerStreamFailureCopy(error: Record<string, unknown> | null): FailureCopy | undefined {
  if (errorString(error, 'code') !== 'provider_stream_interrupted') return undefined;

  const attemptCount = positiveErrorInteger(error, 'attemptCount');
  return {
    title: 'The model response stopped',
    description:
      attemptCount === undefined
        ? 'The connection to the model provider dropped during the response. Rerun the failed jobs.'
        : `The connection to the model provider dropped during the response. Shipfox tried ${attemptCount} ${attemptCount === 1 ? 'time' : 'times'}. Rerun the failed jobs.`,
  };
}

function positiveErrorInteger(
  error: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = error?.[key] ?? error?.[snakeCase(key)];
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function snakeCase(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`);
}

function knownStepFailureCopy(reason: string | undefined): FailureCopy {
  return reason === undefined
    ? UNKNOWN_STEP_FAILURE_COPY
    : (STEP_FAILURE_COPY[reason as keyof typeof STEP_FAILURE_COPY] ?? UNKNOWN_STEP_FAILURE_COPY);
}

function successfulToolCall(attempt: StepAttempt): boolean {
  return attempt.invocations.some((invocation) => invocation.outcome === 'success');
}

function gateCouldNotUseToolResult(
  attempt: StepAttempt,
  error: Record<string, unknown> | null,
): boolean {
  return (
    errorReason(error) === 'gate_uncheckable' &&
    (errorString(error, 'message') === 'step produced no exit code' ||
      errorString(attempt.gateResult, 'reason') === 'step produced no exit code')
  );
}

function gateConditionFailed(attempt: StepAttempt): boolean {
  return attempt.gateResult?.passed === false && attempt.gateResult.uncheckable !== true;
}

function gateEvaluationFailed(attempt: StepAttempt): boolean {
  return errorString(attempt.gateResult, 'reason') === GATE_EVALUATION_ERROR_REASON;
}

function errorReason(error: Record<string, unknown> | null): string | undefined {
  return errorString(error, 'reason') ?? errorString(error, 'kind');
}

function errorString(error: Record<string, unknown> | null, key: string): string | undefined {
  const value = error?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function toolCallName(step: StepAttemptDetailStep): string {
  const provider = toolProvider(step);
  return provider === undefined ? 'tool call' : `${provider} call`;
}

function toolProvider(step: StepAttemptDetailStep): string | undefined {
  const tool = step.config.tool;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return undefined;
  const provider = 'provider' in tool ? tool.provider : undefined;
  return typeof provider === 'string' ? PROVIDER_DISPLAY_NAMES[provider] : undefined;
}

function toolSensitivity(step: StepAttemptDetailStep): string | undefined {
  const tool = step.config.tool;
  if (tool === null || typeof tool !== 'object' || Array.isArray(tool)) return undefined;
  const sensitivity = 'sensitivity' in tool ? tool.sensitivity : undefined;
  return typeof sensitivity === 'string' ? sensitivity : undefined;
}

function recordFailureAnnotationFailure(
  error: unknown,
  reason: 'lookup' | 'budget' | 'write',
  context: Record<string, string | number>,
): void {
  recordWorkflowFailureAnnotationFailed(reason);
  logger().warn({error, reason, ...context}, 'Failed to project workflow failure annotation');
}
