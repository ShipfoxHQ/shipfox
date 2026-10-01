import type {AgentConfigInvalidReason} from '@shipfox/api-agent-dto';
import type {
  AgentIntegrationMaterializationReason,
  WorkflowExecutionPayloadFieldDto,
} from '@shipfox/api-workflows-dto';
import type {JobStatus} from './entities/job.js';
import type {WorkflowRunStatus} from './entities/workflow-run.js';
import type {RequiredAction} from './workspace-admission.js';

export class DefinitionNotFoundError extends Error {
  constructor(definitionId: string) {
    super(`Definition not found: ${definitionId}`);
    this.name = 'DefinitionNotFoundError';
  }
}

export class ProjectMismatchError extends Error {
  constructor(definitionProjectId: string, requestProjectId: string) {
    super(
      `Definition belongs to project ${definitionProjectId}, but request targets project ${requestProjectId}`,
    );
    this.name = 'ProjectMismatchError';
  }
}

export class WorkspaceSuspendedError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace is suspended: ${workspaceId}`);
    this.name = 'WorkspaceSuspendedError';
  }
}

export class WorkspaceDeletedError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace is deleted: ${workspaceId}`);
    this.name = 'WorkspaceDeletedError';
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor(readonly workspaceId: string) {
    super(`Workspace not found: ${workspaceId}`);
    this.name = 'WorkspaceNotFoundError';
  }
}

export class WorkflowAdmissionDeniedError extends Error {
  constructor(
    readonly workspaceId: string,
    readonly reason: string,
    readonly requiredAction?: RequiredAction | undefined,
  ) {
    super(`Workflow admission denied: ${reason}`);
    this.name = 'WorkflowAdmissionDeniedError';
  }
}

export interface AgentConfigUnresolvableErrorOptions {
  readonly cause?: unknown;
  readonly message?: string;
  readonly code?: string;
  readonly managedProviderId?: string;
  readonly reason?: AgentConfigInvalidReason | undefined;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly jobKey?: string | undefined;
  readonly step?: InterpolationUnresolvableStep | undefined;
}

export class AgentConfigUnresolvableError extends Error {
  readonly code?: string | undefined;
  readonly managedProviderId?: string | undefined;
  readonly reason?: AgentConfigInvalidReason | undefined;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
  readonly jobKey?: string | undefined;
  readonly step?: InterpolationUnresolvableStep | undefined;

  constructor(
    readonly definitionId: string,
    private readonly options?: AgentConfigUnresolvableErrorOptions | undefined,
  ) {
    super(
      options?.message ?? `Agent configuration cannot be resolved for definition ${definitionId}`,
      options?.cause === undefined ? undefined : {cause: options.cause},
    );
    this.name = 'AgentConfigUnresolvableError';
    this.code = options?.code;
    this.managedProviderId = options?.managedProviderId;
    this.reason = options?.reason;
    this.model = options?.model;
    this.provider = options?.provider;
    this.jobKey = options?.jobKey;
    this.step = options?.step;
  }

  /** The same failure, placed at the job and step whose agent settings it came from. */
  at(location: {
    readonly jobKey: string;
    readonly step: InterpolationUnresolvableStep;
  }): AgentConfigUnresolvableError {
    return new AgentConfigUnresolvableError(this.definitionId, {
      ...this.options,
      message: this.message,
      ...location,
    });
  }
}

/** The step error reason a failed session claim maps to. */
export type AgentStepSessionClaimReason =
  | 'agent_session_key_invalid'
  | 'agent_session_held'
  | 'agent_session_harness_mismatch'
  | 'agent_session_unavailable';

/** A named agent session could not be claimed at step dispatch. */
export class AgentStepSessionClaimError extends Error {
  constructor(
    readonly reason: AgentStepSessionClaimReason,
    message: string,
  ) {
    super(message);
    this.name = 'AgentStepSessionClaimError';
  }
}

export interface AgentIntegrationMaterializationErrorOptions {
  readonly reason?: AgentIntegrationMaterializationReason | undefined;
  readonly connection?: string | undefined;
  readonly tool?: string | undefined;
  readonly jobKey?: string | undefined;
  readonly step?: InterpolationUnresolvableStep | undefined;
}

export class AgentIntegrationMaterializationError extends Error {
  readonly reason?: AgentIntegrationMaterializationReason | undefined;
  readonly connection?: string | undefined;
  readonly tool?: string | undefined;
  readonly jobKey?: string | undefined;
  readonly step?: InterpolationUnresolvableStep | undefined;

  constructor(
    message: string,
    private readonly options?: AgentIntegrationMaterializationErrorOptions | undefined,
  ) {
    super(message);
    this.name = 'AgentIntegrationMaterializationError';
    this.reason = options?.reason;
    this.connection = options?.connection;
    this.tool = options?.tool;
    this.jobKey = options?.jobKey;
    this.step = options?.step;
  }

  /** The same failure, placed at the job and step whose integrations it came from. */
  at(location: {
    readonly jobKey: string;
    readonly step: InterpolationUnresolvableStep;
  }): AgentIntegrationMaterializationError {
    return new AgentIntegrationMaterializationError(this.message, {...this.options, ...location});
  }
}

export class ToolConfigInvalidError extends Error {
  readonly code = 'tool_config_invalid';

  constructor(message: string) {
    super(message);
    this.name = 'ToolConfigInvalidError';
  }
}

export class ActionInputInvalidError extends Error {
  readonly code = 'action_input_invalid';

  constructor(
    message: string,
    readonly input: string,
  ) {
    super(message);
    this.name = 'ActionInputInvalidError';
  }
}

export type InterpolationUnresolvableField =
  | 'run'
  | 'env'
  | 'agent.prompt'
  | 'agent.model'
  | 'agent.provider'
  | 'agent.thinking'
  | 'agent.session'
  | 'job.if'
  | 'job.success'
  | 'job.listening.filter'
  | 'job.runner'
  | 'job.outputs'
  | 'job.execution_name'
  | 'workflow.outputs'
  | 'workflow.concurrency.group'
  | 'workflow.run_name'
  | 'step.name'
  | 'step.if'
  | 'step.gate.success'
  | 'step.working_directory'
  | 'step.feedback'
  | 'tool.with'
  | 'tool.outputs'
  | 'action.with'
  | 'checkout.project'
  | 'checkout.connection'
  | 'checkout.repository'
  | 'checkout.ref'
  | 'checkout.path';

export interface InterpolationUnresolvableStep {
  readonly key?: string | undefined;
  readonly name?: string | undefined;
  /** 1-based position among the job's authored steps. */
  readonly index: number;
}

interface InterpolationUnresolvableParams {
  readonly field: InterpolationUnresolvableField;
  readonly source: string;
  readonly envKey?: string | undefined;
  /** Set when the failure is a `vars.*` key that does not exist. */
  readonly variableKey?: string | undefined;
  readonly jobKey?: string | undefined;
  readonly step?: InterpolationUnresolvableStep | undefined;
}

export class InterpolationUnresolvableError extends Error {
  readonly field: InterpolationUnresolvableField;
  readonly source: string;
  readonly envKey?: string;
  readonly variableKey?: string;
  readonly jobKey?: string;
  readonly step?: InterpolationUnresolvableStep;

  constructor(
    readonly definitionId: string,
    params: InterpolationUnresolvableParams & {
      /** The expression reads a context this fill site does not carry, not a missing value. */
      readonly contextUnavailable?: boolean;
      readonly cause?: unknown;
    },
  ) {
    super(interpolationUnresolvableMessage(definitionId, params), {cause: params.cause});
    this.name = 'InterpolationUnresolvableError';
    this.field = params.field;
    this.source = params.source;
    if (params.envKey !== undefined) this.envKey = params.envKey;
    if (params.variableKey !== undefined) this.variableKey = params.variableKey;
    if (params.jobKey !== undefined) this.jobKey = params.jobKey;
    if (params.step !== undefined) this.step = params.step;
  }
}

function interpolationUnresolvableMessage(
  definitionId: string,
  params: InterpolationUnresolvableParams & {readonly contextUnavailable?: boolean},
): string {
  const envSuffix = params.envKey === undefined ? '' : ` (${params.envKey})`;
  const prefix = `Workflow interpolation cannot be resolved for definition ${definitionId}: ${params.field}${envSuffix} uses \`${params.source}\`.`;
  if (params.variableKey !== undefined)
    return `${prefix} Variable ${params.variableKey} is not set.`;
  const hint =
    params.contextUnavailable === true
      ? 'It reads a context that is not available where this field is filled.'
      : "Use has(x) ? x : '' for optional references.";
  return `${prefix} ${hint}`;
}

/**
 * True when a `runWorkflow` failure can never succeed on retry: the definition is gone or
 * the subscription points at the wrong project. Callers (e.g. the trigger dispatcher) use this
 * to skip a permanently-broken target instead of retrying it forever. Every other failure is
 * treated as transient so at-least-once delivery can converge.
 */
export function isPermanentRunWorkflowError(error: unknown): boolean {
  return (
    error instanceof DefinitionNotFoundError ||
    error instanceof ProjectMismatchError ||
    error instanceof AgentConfigUnresolvableError ||
    error instanceof AgentIntegrationMaterializationError ||
    error instanceof InterpolationUnresolvableError ||
    error instanceof InvalidJobRunnerLabelsError ||
    error instanceof WorkflowSourceSnapshotTooLargeError ||
    error instanceof WorkflowExecutionPayloadTooLargeError
  );
}

export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job not found or has no steps: ${jobId}`);
    this.name = 'JobNotFoundError';
  }
}

export class InvalidJobRunnerLabelsError extends Error {
  constructor(
    readonly labels: readonly string[],
    readonly requestedLabels: readonly string[] = labels,
  ) {
    const requestedSuffix =
      requestedLabels.join(', ') === labels.join(', ')
        ? ''
        : ` (requested: ${requestedLabels.join(', ')})`;
    super(`Job runner labels are invalid: ${labels.join(', ')}${requestedSuffix}`);
    this.name = 'InvalidJobRunnerLabelsError';
  }
}

/** Job outputs and workflow outputs share one materializer and its limits. */
export type OutputOwner = 'job' | 'workflow';

function outputOwnerLabel(owner: OutputOwner): string {
  return owner === 'workflow' ? 'Workflow' : 'Job';
}

export class JobOutputTooLargeError extends Error {
  readonly overshootBytes: number;

  constructor(
    readonly outputKey: string,
    readonly limitBytes: number,
    readonly measuredBytes: number,
    readonly scope: 'value' | 'total',
    readonly owner: OutputOwner = 'job',
  ) {
    const overshootBytes = measuredBytes - limitBytes;
    const label = outputOwnerLabel(owner);
    super(
      scope === 'total'
        ? `${label} outputs exceed the total size limit of ${limitBytes} bytes at "${outputKey}" ` +
            `(measured ${measuredBytes} bytes; overshoot ${overshootBytes} bytes).`
        : `${label} output "${outputKey}" exceeds the per-value size limit of ${limitBytes} bytes ` +
            `(measured ${measuredBytes} bytes; overshoot ${overshootBytes} bytes).`,
    );
    this.name = 'JobOutputTooLargeError';
    this.overshootBytes = overshootBytes;
  }
}

export class JobOutputTooManyEntriesError extends Error {
  constructor(
    readonly entryCount: number,
    readonly limitEntries: number,
    readonly owner: OutputOwner = 'job',
  ) {
    super(
      `${outputOwnerLabel(owner)} outputs cannot define more than ${limitEntries} entries (found ${entryCount})`,
    );
    this.name = 'JobOutputTooManyEntriesError';
  }
}

export class JobOutputNotJsonSafeError extends Error {
  constructor(
    readonly outputKey: string,
    readonly reason: string,
    readonly owner: OutputOwner = 'job',
  ) {
    super(
      `${outputOwnerLabel(owner)} output "${outputKey}" cannot be persisted as JSON: ${reason}`,
    );
    this.name = 'JobOutputNotJsonSafeError';
  }
}

export class WorkflowSourceSnapshotTooLargeError extends Error {
  readonly overshootBytes: number;

  constructor(
    readonly limitBytes: number,
    readonly measuredBytes: number,
  ) {
    const overshootBytes = measuredBytes - limitBytes;
    super(
      `Workflow source snapshot exceeds the size limit of ${limitBytes} bytes ` +
        `(measured ${measuredBytes} bytes; overshoot ${overshootBytes} bytes).`,
    );
    this.name = 'WorkflowSourceSnapshotTooLargeError';
    this.overshootBytes = overshootBytes;
  }
}

/**
 * @deprecated Only for reading and mapping legacy records. New writes use
 * field-specific execution or product-output policies.
 */
export class WorkflowDiagnosticTooLargeError extends Error {
  readonly overshootBytes: number;

  constructor(
    readonly field: string,
    readonly limitBytes: number,
    readonly measuredBytes: number,
  ) {
    const overshootBytes = measuredBytes - limitBytes;
    super(
      `Workflow diagnostic field "${field}" exceeds the size limit of ${limitBytes} bytes ` +
        `(measured ${measuredBytes} bytes; overshoot ${overshootBytes} bytes).`,
    );
    this.name = 'WorkflowDiagnosticTooLargeError';
    this.overshootBytes = overshootBytes;
  }
}

/**
 * An execution value cannot cross its owning write boundary. Keep this error
 * distinct from diagnostic read overages: a valid execution payload may be
 * larger than the inline diagnostic allowance.
 */
export class WorkflowExecutionPayloadTooLargeError extends Error {
  readonly overshootBytes: number;
  readonly code = 'workflow-execution-payload-too-large';

  constructor(
    readonly field: WorkflowExecutionPayloadFieldDto,
    readonly limitBytes: number,
    readonly measuredBytes: number,
  ) {
    const overshootBytes = measuredBytes - limitBytes;
    super(
      `Workflow execution payload field "${field}" exceeds the size limit of ${limitBytes} bytes ` +
        `(measured ${measuredBytes} bytes; overshoot ${overshootBytes} bytes).`,
    );
    this.name = 'WorkflowExecutionPayloadTooLargeError';
    this.overshootBytes = overshootBytes;
  }
}

/** A step result value is too large to persist as attempt history. */
export class WorkflowStepResultTooLargeError extends Error {
  readonly overshootBytes: number;

  constructor(
    readonly field: string,
    readonly limitBytes: number,
    readonly measuredBytes: number,
  ) {
    const overshootBytes = measuredBytes - limitBytes;
    super(
      `Workflow step result field "${field}" exceeds the size limit of ${limitBytes} bytes ` +
        `(measured ${measuredBytes} bytes; overshoot ${overshootBytes} bytes).`,
    );
    this.name = 'WorkflowStepResultTooLargeError';
    this.overshootBytes = overshootBytes;
  }
}

export class WorkflowStepAttemptInvocationLimitError extends Error {
  constructor(
    readonly count: number,
    readonly limit: number,
  ) {
    super(`Step attempt invocation history cannot exceed ${limit} entries (found ${count})`);
    this.name = 'WorkflowStepAttemptInvocationLimitError';
  }
}

// The job named by a lease is terminal, so it must not exchange its lease for
// fresh checkout credentials. Server state is the final gate, not the token.
export class JobNotActiveError extends Error {
  constructor(
    readonly jobId: string,
    readonly status: JobStatus,
  ) {
    super(`Job ${jobId} is ${status} and cannot mint checkout credentials`);
    this.name = 'JobNotActiveError';
  }
}

export class WorkflowRunDepthExceededError extends Error {
  constructor() {
    super('Workflow run depth limit exceeded');
    this.name = 'WorkflowRunDepthExceededError';
  }
}

export class WorkflowRunTreeLimitExceededError extends Error {
  constructor() {
    super('Workflow run tree size limit exceeded');
    this.name = 'WorkflowRunTreeLimitExceededError';
  }
}

export class WorkflowRunNotFoundError extends Error {
  constructor(workflowRunId: string) {
    super(`Workflow run not found: ${workflowRunId}`);
    this.name = 'WorkflowRunNotFoundError';
  }
}

export class WorkflowRunNotCancellableError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly status: WorkflowRunStatus,
  ) {
    super(`Workflow run ${workflowRunId} is ${status} and cannot be cancelled`);
    this.name = 'WorkflowRunNotCancellableError';
  }
}

export class WorkflowRunAttemptMismatchError extends Error {
  constructor(
    readonly workflowRunId: string,
    readonly currentAttempt: number,
  ) {
    super(
      `Workflow run ${workflowRunId} is on attempt ${currentAttempt}, not the expected attempt`,
    );
    this.name = 'WorkflowRunAttemptMismatchError';
  }
}

export class SourceRunNotFoundError extends Error {
  constructor(workflowRunId: string) {
    super(`Source workflow run not found: ${workflowRunId}`);
    this.name = 'SourceRunNotFoundError';
  }
}

export class RunNotTerminalError extends Error {
  constructor(workflowRunId: string) {
    super(`Workflow run is not terminal: ${workflowRunId}`);
    this.name = 'RunNotTerminalError';
  }
}

export class NoFailedJobsError extends Error {
  constructor(workflowRunId: string) {
    super(`Workflow run has no failed or cancelled jobs to re-run: ${workflowRunId}`);
    this.name = 'NoFailedJobsError';
  }
}

// The checkout target cannot be resolved, so there is nothing to check out.
export class CheckoutIntentUnresolvedError extends Error {
  constructor(target: {kind: 'project' | 'connection'; value: string}) {
    super(`Checkout intent unresolved: ${target.kind} ${target.value} not found`);
    this.name = 'CheckoutIntentUnresolvedError';
  }
}

export class CheckoutConfigInvalidError extends Error {
  constructor(readonly stepId: string) {
    super(`Checkout config is invalid for step ${stepId}`);
    this.name = 'CheckoutConfigInvalidError';
  }
}

export class CheckoutRepositoryUrlInvalidError extends Error {
  constructor(readonly reason: 'credentials' | 'invalid') {
    super(
      reason === 'credentials'
        ? 'Checkout repository URL must not embed credentials'
        : 'Checkout repository URL must be valid',
    );
    this.name = 'CheckoutRepositoryUrlInvalidError';
  }
}

export class StepNotFoundError extends Error {
  constructor(stepId: string, jobId: string) {
    super(`Step ${stepId} not found in job ${jobId}`);
    this.name = 'StepNotFoundError';
  }
}

export class StepNotRunningError extends Error {
  constructor(stepId: string, jobId: string) {
    super(`Step ${stepId} in job ${jobId} is not running and cannot accept a result`);
    this.name = 'StepNotRunningError';
  }
}

// A report whose attempt is ahead of the step's current attempt. The host
// allocates attempt numbers, so a runner can never report one it was not
// dispatched: this is a protocol error, not an idempotent no-op.
export class StepAttemptAheadError extends Error {
  constructor(
    readonly stepId: string,
    readonly jobId: string,
    readonly reportedAttempt: number,
    readonly currentAttempt: number,
  ) {
    super(
      `Step ${stepId} in job ${jobId} reported attempt ${reportedAttempt} ahead of current attempt ${currentAttempt}`,
    );
    this.name = 'StepAttemptAheadError';
  }
}
