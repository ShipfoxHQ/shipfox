import {deriveStepErrorCategory} from '@shipfox/api-workflows-dto';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import type {Job, JobExecution, Step, StepError} from '#core/workflow-run.js';
import {
  AGENT_CONFIG_ISSUES,
  deriveJobDisplayStatus,
  deriveJobExecutionDisplayStatus,
  STEP_ERROR_REASONS,
} from '#core/workflow-run.js';
import type {StepListEmptyState} from '../step-list/index.js';
import {formatJobExecutionTime} from './job-execution-time-text.js';

const MATERIALIZED_OUTPUT_FAILURE_DESCRIPTION =
  'Shipfox cannot save a job output. The output is too large, is not valid JSON, or uses a missing value. Fix the job outputs, then start a new run.';
const OUTPUT_TOO_LARGE_FAILURE_DESCRIPTION =
  'The job output is too large. Make the outputs smaller, or write large data to a file. Then start a new run.';
const LISTENER_FILTER_SNAPSHOT_TOO_LARGE_DESCRIPTION =
  'The data for the listener filter is too large. Make the filter or the outputs of needed jobs smaller. Then start a new run.';

export function outputFailureDescriptionForExecution(
  jobExecution: JobExecution,
): string | undefined {
  if (jobExecution.steps.length === 0) return undefined;

  if (jobExecution.statusReason === 'output_invalid') {
    return jobExecution.statusReasonMessage || MATERIALIZED_OUTPUT_FAILURE_DESCRIPTION;
  }
  if (jobExecution.statusReason === 'output_too_large') {
    return jobExecution.statusReasonMessage || OUTPUT_TOO_LARGE_FAILURE_DESCRIPTION;
  }
  return undefined;
}

export function MaterializedOutputFailureNotice({jobExecution}: {jobExecution: JobExecution}) {
  const description = outputFailureDescriptionForExecution(jobExecution);
  if (!description) return null;

  return (
    <Callout
      role="alert"
      type="error"
      variant="secondary"
      className="border-b border-border-neutral-base px-row py-row"
    >
      <CalloutContent>
        <CalloutTitle>Shipfox cannot save the job output</CalloutTitle>
        <CalloutDescription>{description}</CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}

export function emptyStateForJob(
  job: Job,
  jobExecution: JobExecution,
): StepListEmptyState | undefined {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  const displayStatus =
    job.mode === 'listening'
      ? deriveJobExecutionDisplayStatus(jobExecution)
      : deriveJobDisplayStatus(job);
  const runner = jobExecution.runner?.length ? jobExecution.runner : job.runner;

  if (jobExecution.status === 'running' && displayStatus === 'pending') {
    return {
      title: runner?.length ? 'Runner preparing job' : 'Waiting for a runner',
      description: runner?.length
        ? `Runner ${runner.join(', ')} is preparing the job. Steps will appear here when work begins.`
        : 'No runner has picked up this job yet. Steps will appear here when a runner starts work.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'pending') {
    return (
      workspaceCapacityEmptyState(jobExecution, displayStatus) ?? {
        title: 'Waiting for this job to start',
        description: 'Steps will appear here once the job starts.',
        status: displayStatus,
      }
    );
  }

  if (displayStatus === 'running') {
    return {
      title: 'Waiting for the first step',
      description: 'The first running step will appear here shortly.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job is cancelled. No step started.',
      status: displayStatus,
    };
  }

  if (displayStatus === 'failed') {
    return {
      title: 'Job failed before its first step started',
      description: failureDescription(job, jobExecution, runner),
      status: displayStatus,
      ...noticeAction(jobExecution),
    };
  }

  if (displayStatus === 'succeeded') {
    return {
      title: 'Completed without recorded steps',
      description: `Execution #${jobExecution.sequence} succeeded before any step output was recorded.`,
      status: displayStatus,
    };
  }

  return undefined;
}

function workspaceCapacityEmptyState(
  jobExecution: JobExecution,
  status: StepListEmptyState['status'],
): StepListEmptyState | undefined {
  const waitDetail =
    jobExecution.waitReason === 'workspace-capacity' ? jobExecution.waitDetail : undefined;
  if (!waitDetail) return undefined;
  const {inUse, capacity, unitLabel, requiredAction} = waitDetail;
  return {
    title: 'Queued for workspace capacity',
    description: `Queued: this workspace is using ${inUse} of ${capacity} ${unitLabel} it can run at once. The job starts when a running job finishes.`,
    status,
    ...(requiredAction ? {action: {label: requiredAction.message, href: requiredAction.url}} : {}),
  };
}

function failureDescription(job: Job, jobExecution: JobExecution, runner: string[] | null): string {
  const description = preStepFailureDescription(
    jobExecution.statusReason ?? job.statusReason,
    runner,
    jobExecution.statusReasonMessage,
  );
  const notice = jobExecution.statusReasonNotice;
  return notice?.reason === 'workspace-capacity' ? `${description} ${notice.message}` : description;
}

function noticeAction(jobExecution: JobExecution): Pick<StepListEmptyState, 'action'> {
  const requiredAction = jobExecution.statusReasonNotice?.requiredAction;
  if (!requiredAction) return {};
  if (
    jobExecution.statusReason !== 'runner_not_allowed' &&
    jobExecution.statusReason !== 'queue_timed_out'
  )
    return {};
  return {action: {label: requiredAction.message, href: requiredAction.url}};
}

export function emptyStateForMissingExecution(job: Job): StepListEmptyState {
  if (job.carriedOver) {
    return {
      title: 'Carried over from a previous attempt',
      description: 'This job did not execute in this run.',
      status: 'succeeded',
    };
  }

  if (job.mode === 'listening' && job.listenerStatus === 'listening') {
    return {
      title: 'Waiting for trigger events',
      description: 'Matching trigger events will create job executions here.',
      status: deriveJobDisplayStatus(job),
    };
  }

  if (job.mode === 'listening' && job.listenerStatus === 'resolved') {
    return {
      title: 'Listener resolved without executions',
      description: 'No matching trigger event created a job execution before the listener stopped.',
      status: job.status,
    };
  }

  if (job.status === 'pending') {
    return {
      title: 'Waiting for this job to start',
      description: 'No execution has been created for this job yet.',
      status: 'pending',
    };
  }

  if (job.status === 'skipped') {
    return {
      title: 'This job was skipped',
      description: skippedJobDescription(job.statusReason),
      status: 'skipped',
    };
  }

  if (job.status === 'cancelled') {
    return {
      title: 'Cancelled before start',
      description: 'This job is cancelled. It did not start.',
      status: 'cancelled',
    };
  }

  if (job.status === 'failed') {
    return {
      title: 'The job failed before it started',
      description: missingExecutionFailureDescription(job),
      status: 'failed',
    };
  }

  return {
    title: 'Execution details unavailable',
    description: 'This job finished, but no job execution record is available.',
    status: job.status,
  };
}

function missingExecutionFailureDescription(job: Job): string {
  if (job.mode === 'listening' && job.statusReason === 'output_too_large') {
    return LISTENER_FILTER_SNAPSHOT_TOO_LARGE_DESCRIPTION;
  }
  return preStepFailureDescription(job.statusReason, job.runner);
}

export function skippedJobDescription(reason: Job['statusReason']): string {
  switch (reason) {
    case 'dependency_not_completed':
      return 'This job needs another job that did not finish.';
    case 'default_gate_rejected':
      return 'This job needs another job that did not succeed.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The if condition of this job is false.';
    case 'condition_errored':
      return 'Shipfox cannot evaluate the if condition of this job. Fix it, then start a new run.';
    case 'user_cancelled':
    case 'run_cancelled':
    case 'concurrency_superseded':
    case 'queue_timed_out':
    case 'timed_out':
    case 'lease_expired':
    case 'provider_lost':
    case 'lifecycle_violation':
    case 'runner_lost':
    case 'output_invalid':
    case 'runner_not_allowed':
    case 'step_failed':
    case 'unknown':
    case null:
      return 'This job did not start.';
    case 'output_too_large':
      return 'The job output is too large.';
  }
}

function preStepFailureDescription(
  reason: string | null,
  runner: string[] | null = null,
  statusReasonMessage: string | null = null,
): string {
  const runnerCopy = runner?.length ? ` Required runner labels: ${runner.join(', ')}.` : '';

  switch (reason) {
    case 'lease_expired':
    case 'provider_lost':
    case 'lifecycle_violation':
    case 'runner_lost':
      return 'The runner stopped responding before the job started. Rerun the job. If it fails again, contact your workspace admin.';
    case 'queue_timed_out':
      return (
        statusReasonMessage ||
        'No runner picked up this job before the queue timeout. Rerun the job when a runner is free.'
      );
    case 'runner_not_allowed':
      return (
        statusReasonMessage ||
        'This workspace cannot use the requested runner. Choose another runner, then start a new run. Or contact your workspace admin.'
      );
    case 'timed_out':
      return (
        statusReasonMessage ||
        'The job reached its timeout before it started. Rerun the job. If it fails again, contact your workspace admin.'
      );
    case 'user_cancelled':
      return 'A user cancelled the job before it started. Start a new run if you still need the result.';
    case 'run_cancelled':
      return 'The run is cancelled, so this job did not start. Start a new run if you still need the result.';
    case 'step_failed':
      return `The job failed before Shipfox saved any step details.${runnerCopy} Read the run annotations, then rerun the job.`;
    case 'output_too_large':
      return statusReasonMessage || OUTPUT_TOO_LARGE_FAILURE_DESCRIPTION;
    case 'output_invalid':
      return statusReasonMessage || MATERIALIZED_OUTPUT_FAILURE_DESCRIPTION;
    case 'condition_errored':
      return 'Shipfox cannot evaluate the if condition of this job. Fix it, then start a new run.';
    case 'dependency_not_completed':
    case 'default_gate_rejected':
      return 'This job needs another job that did not succeed. Fix that job first.';
    case 'condition_false':
    case 'condition_rejected':
      return 'The if condition of this job is false, so the job did not start.';
    case 'unknown':
    case null:
      return `Shipfox does not know why this job failed.${runnerCopy} Check the runner and the workflow file, then rerun the job.`;
    default:
      return `The job failed before it started.${runnerCopy} Read the run annotations, then rerun the job.`;
  }
}

export function CarriedOverStepPanel() {
  return (
    <EmptyState
      className="rounded-8 border border-border-neutral-base bg-background-components-base"
      icon="componentLine"
      title="Carried over from a previous attempt"
      description="Not executed in this run."
      variant="panel"
    />
  );
}

export function toSelectedAttemptError(
  step: Step,
  error: Record<string, unknown> | null,
): StepError | null {
  if (error === null) return null;

  const parsedReason = parsedStepErrorReason(error.reason) ?? parsedStepErrorReason(error.kind);
  const rawAgentConfigIssue = error.agentConfigIssue ?? error.agent_config_issue;
  const agentConfigIssue = parsedAgentConfigIssue(rawAgentConfigIssue);
  const exitCode = error.exitCode ?? error.exit_code;
  const resolvedReason = parsedReason ?? (agentConfigIssue ? 'agent_config_invalid' : undefined);

  if (resolvedReason === undefined) return null;

  const stringFields = selectedErrorStringFields(error);
  const diagnosticFields = selectedGateDiagnosticFields(error);
  const managedProviderId = selectedManagedProviderId(error);

  return {
    message: typeof error.message === 'string' ? error.message : '',
    ...stringFields,
    ...diagnosticFields,
    ...(managedProviderId === undefined ? {} : {managedProviderId}),
    exitCode: exitCode === null || typeof exitCode === 'number' ? exitCode : null,
    signal: typeof error.signal === 'string' ? error.signal : undefined,
    ...(typeof error.retryable === 'boolean' ? {retryable: error.retryable} : {}),
    reason: resolvedReason,
    agentConfigIssue,
    category: deriveStepErrorCategory(step.type, resolvedReason, stringFields.code),
  };
}

function selectedErrorStringFields(
  error: Record<string, unknown>,
): Pick<StepError, 'code' | 'field' | 'source'> {
  return {
    ...(typeof error.code === 'string' ? {code: error.code} : {}),
    ...(typeof error.field === 'string' ? {field: error.field} : {}),
    ...(typeof error.source === 'string' ? {source: error.source} : {}),
  };
}

function selectedGateDiagnosticFields(
  error: Record<string, unknown>,
): Pick<StepError, 'attemptCount' | 'maxAttempts' | 'restartFrom'> {
  const attemptCount = positiveInteger(error.attemptCount ?? error.attempt_count);
  const maxAttempts = positiveInteger(error.maxAttempts ?? error.max_attempts);
  const restartFrom = selectedRestartFrom(error);
  return {
    ...(attemptCount === undefined ? {} : {attemptCount}),
    ...(maxAttempts === undefined ? {} : {maxAttempts}),
    ...(restartFrom === undefined ? {} : {restartFrom}),
  };
}

function selectedRestartFrom(error: Record<string, unknown>): string | undefined {
  if (typeof error.restartFrom === 'string') return error.restartFrom;
  if (typeof error.restart_from === 'string') return error.restart_from;
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function parsedStepErrorReason(value: unknown): NonNullable<StepError['reason']> | undefined {
  if (typeof value !== 'string') return undefined;
  if (!STEP_ERROR_REASONS.has(value as StepError['reason'] & string)) return undefined;
  return value as NonNullable<StepError['reason']>;
}

function parsedAgentConfigIssue(
  value: unknown,
): NonNullable<StepError['agentConfigIssue']> | undefined {
  if (typeof value !== 'string') return undefined;
  if (!AGENT_CONFIG_ISSUES.has(value as NonNullable<StepError['agentConfigIssue']>))
    return undefined;
  return value as NonNullable<StepError['agentConfigIssue']>;
}

function selectedManagedProviderId(error: Record<string, unknown>): string | undefined {
  if (typeof error.managedProviderId === 'string') return error.managedProviderId;
  if (typeof error.managed_provider_id === 'string') return error.managed_provider_id;
  return undefined;
}

export function isAgentConfigFailure(step: Step, error: StepError | null): boolean {
  return step.type === 'agent' && error?.reason === 'agent_config_invalid';
}

export function jobSucceededSummary(job: Job, execution: JobExecution): string | undefined {
  if (job.carriedOver || execution.status !== 'succeeded') return undefined;
  const stepCount = execution.steps.filter((step) => step.status === 'succeeded').length;
  if (stepCount === 0) return undefined;
  const duration = execution.displayDuration;
  return `${stepCount} step${stepCount === 1 ? '' : 's'} succeeded${duration ? ` in ${formatJobExecutionTime(duration)}` : ''}`;
}
