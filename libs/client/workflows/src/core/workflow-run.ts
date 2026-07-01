import type {
  AgentConfigIssueDto,
  JobStatusDto,
  JobStatusReasonDto,
  StepAttemptDto,
  StepErrorCategoryDto,
  StepErrorReasonDto,
  StepGateResultDto,
  StepRestartResultDto,
  StepSourceLocationDto,
  WorkflowRunAttemptDto,
  WorkflowRunDetailResponseDto,
  WorkflowRunJobDetailDto,
  WorkflowRunListResponseDto,
  WorkflowRunResponseDto,
  WorkflowRunStatusDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';

export type WorkflowRunStatus = WorkflowRunStatusDto;
export type WorkflowJobStatus = JobStatusDto;
export type WorkflowJobStatusReason = JobStatusReasonDto;
export type WorkflowStatus = WorkflowRunStatus | WorkflowJobStatus;
export type WorkflowStepErrorReason = StepErrorReasonDto;
export type WorkflowAgentConfigIssue = AgentConfigIssueDto;
export type WorkflowStepErrorCategory = StepErrorCategoryDto;
export type WorkflowStepGateResult = StepGateResultDto;
export type WorkflowStepRestartResult = StepRestartResultDto;

export type WorkflowJobDuration =
  | {kind: 'none'}
  | {kind: 'queued'; fromIso: string}
  | {kind: 'running'; fromIso: string}
  | {kind: 'finished'; fromIso: string; toIso: string};

type WorkflowJobDurationDto = RunJobDetailDto['duration'];

export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly WorkflowRunStatus[];

export const TERMINAL_WORKFLOW_RUN_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly WorkflowRunStatus[];

export const WORKFLOW_JOB_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const satisfies readonly WorkflowJobStatus[];

export const TERMINAL_WORKFLOW_JOB_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
  'skipped',
] as const satisfies readonly WorkflowJobStatus[];

const WORKFLOW_STATUSES = new Set<WorkflowStatus>([
  ...WORKFLOW_RUN_STATUSES,
  ...WORKFLOW_JOB_STATUSES,
]);
const TERMINAL_WORKFLOW_RUN_STATUS_SET = new Set<WorkflowRunStatus>(TERMINAL_WORKFLOW_RUN_STATUSES);
const TERMINAL_WORKFLOW_JOB_STATUS_SET = new Set<WorkflowJobStatus>(TERMINAL_WORKFLOW_JOB_STATUSES);

export interface WorkflowSourceSnapshot {
  content: string;
  format: 'yaml';
}

export interface WorkflowStepSourceLocation {
  startLine: number;
  endLine: number;
}

export interface WorkflowStepError {
  message: string;
  exitCode: number | null;
  signal: string | undefined;
  reason: WorkflowStepErrorReason | undefined;
  agentConfigIssue: WorkflowAgentConfigIssue | undefined;
  category: WorkflowStepErrorCategory | undefined;
}

export interface WorkflowAgentStepConfig {
  provider: string | null;
  model: string | null;
  thinking: string | null;
}

export interface WorkflowStepAttempt {
  id: string;
  stepId: string;
  jobId: string;
  jobExecutionId: string;
  attempt: number;
  executionOrder: number;
  status: string;
  exitCode: number | null;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  gateResult: WorkflowStepGateResult;
  restartReason: string | null;
  restartResult: WorkflowStepRestartResult;
  startedAt: string;
  finishedAt: string | null;
}

export interface WorkflowStep {
  id: string;
  jobId: string;
  jobExecutionId: string;
  name: string | null;
  displayName: string;
  sourceLocation: WorkflowStepSourceLocation | null;
  status: string;
  type: string;
  config: Record<string, unknown>;
  agentConfig: WorkflowAgentStepConfig | null;
  error: WorkflowStepError | null;
  position: number;
  currentAttempt: number;
  createdAt: string;
  updatedAt: string;
  attempts: WorkflowStepAttempt[];
}

export interface WorkflowJob {
  id: string;
  runAttemptId: string;
  name: string;
  status: WorkflowJobStatus;
  statusReason: WorkflowJobStatusReason | null;
  carriedOver: boolean;
  dependencies: string[];
  position: number;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  duration: WorkflowJobDuration;
  steps: WorkflowStep[];
}

export interface WorkflowRun {
  id: string;
  projectId: string;
  definitionId: string;
  name: string;
  status: WorkflowRunStatus;
  currentAttempt: number;
  triggerSource: string;
  triggerEvent: string;
  triggerDisplayLabel: string;
  triggerLabel: string;
  triggerPayload: Record<string, unknown>;
  inputs: Record<string, unknown> | null;
  sourceSnapshot: WorkflowSourceSnapshot | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  shortId: string;
  isTemporary: boolean;
}

export interface WorkflowRunDetail extends WorkflowRun {
  latestAttempt: number;
  runAttempt: WorkflowRunAttempt;
  jobs: WorkflowJob[];
}

export interface WorkflowRunAttempt {
  id: string;
  workflowRunId: string;
  attempt: number;
  status: WorkflowRunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  rerunMode: 'all' | 'failed' | null;
}

export interface WorkflowRunListPage {
  runs: WorkflowRun[];
  nextCursor: string | null;
  filteredTotalCount: number | null;
}

export function workflowRunShortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function workflowRunTriggerLabel({
  triggerSource,
  triggerEvent,
}: {
  triggerSource: string;
  triggerEvent: string;
}): string {
  return [triggerSource, triggerEvent].filter(Boolean).join(' · ');
}

export function workflowRunTriggerDisplayLabel({
  triggerSource,
  triggerEvent,
}: {
  triggerSource: string;
  triggerEvent: string;
}): string {
  return triggerEvent || triggerSource;
}

export function isWorkflowRunTerminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUS_SET.has(status);
}

export function isTerminalJobStatus(status: WorkflowJobStatus): boolean {
  return TERMINAL_WORKFLOW_JOB_STATUS_SET.has(status);
}

export function isWorkflowStatus(status: string): status is WorkflowStatus {
  return WORKFLOW_STATUSES.has(status as WorkflowStatus);
}

export function toWorkflowRun(dto: WorkflowRunResponseDto): WorkflowRun {
  const triggerLabel = workflowRunTriggerLabel({
    triggerSource: dto.trigger_source,
    triggerEvent: dto.trigger_event,
  });
  const triggerDisplayLabel = workflowRunTriggerDisplayLabel({
    triggerSource: dto.trigger_source,
    triggerEvent: dto.trigger_event,
  });

  return {
    id: dto.id,
    projectId: dto.project_id,
    definitionId: dto.definition_id,
    name: dto.name,
    status: dto.status,
    currentAttempt: dto.current_attempt,
    triggerSource: dto.trigger_source,
    triggerEvent: dto.trigger_event,
    triggerDisplayLabel,
    triggerLabel,
    triggerPayload: dto.trigger_payload,
    inputs: dto.inputs ?? null,
    sourceSnapshot: dto.source_snapshot ? toWorkflowSourceSnapshot(dto.source_snapshot) : null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
    shortId: workflowRunShortId(dto.id),
    isTemporary: dto.id.startsWith('temp-'),
  };
}

export function toWorkflowRunDetail(dto: WorkflowRunDetailResponseDto): WorkflowRunDetail {
  return {
    ...toWorkflowRun(dto),
    latestAttempt: dto.latest_attempt,
    runAttempt: toWorkflowRunAttempt(dto.run_attempt),
    jobs: dto.jobs.map(toWorkflowJob),
  };
}

export function toWorkflowRunListPage(dto: WorkflowRunListResponseDto): WorkflowRunListPage {
  return {
    runs: dto.runs.map(toWorkflowRun),
    nextCursor: dto.next_cursor,
    filteredTotalCount: dto.filtered_total_count,
  };
}

export function toWorkflowJob(dto: WorkflowRunJobDetailDto): WorkflowJob {
  return {
    id: dto.id,
    runAttemptId: dto.run_attempt_id,
    name: dto.name,
    status: dto.status,
    statusReason: dto.status_reason,
    carriedOver: dto.carried_over,
    dependencies: dto.dependencies,
    position: dto.position,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    queuedAt: dto.queued_at ?? null,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
    duration: toWorkflowJobDuration(dto.duration),
    // The current client UI is single-job-execution: multi-job-execution grouping belongs to ENG-675.
    steps: dto.job_executions.flatMap((jobExecution) =>
      jobExecution.steps.map((step) => toWorkflowStep(step, dto.id)),
    ),
  };
}

export function toWorkflowStep(dto: WorkflowRunStepDetailDto, jobId: string): WorkflowStep {
  return {
    id: dto.id,
    jobId,
    jobExecutionId: dto.job_execution_id,
    name: dto.name,
    displayName: dto.display_name,
    sourceLocation: dto.source_location ? toWorkflowStepSourceLocation(dto.source_location) : null,
    status: dto.status,
    type: dto.type,
    config: dto.config,
    agentConfig: toWorkflowAgentStepConfig(dto),
    error: dto.error ? toWorkflowStepError(dto.error) : null,
    position: dto.position,
    currentAttempt: dto.current_attempt,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    attempts: dto.attempts.map((attempt) =>
      toWorkflowStepAttempt(attempt, jobId, dto.job_execution_id),
    ),
  };
}

function toWorkflowJobDuration(dto: WorkflowJobDurationDto): WorkflowJobDuration {
  switch (dto.kind) {
    case 'none':
      return {kind: 'none'};
    case 'queued':
      return {kind: 'queued', fromIso: dto.from_iso};
    case 'running':
      return {kind: 'running', fromIso: dto.from_iso};
    case 'finished':
      return {kind: 'finished', fromIso: dto.from_iso, toIso: dto.to_iso};
    default: {
      const exhaustive: never = dto;
      return exhaustive;
    }
  }
}

export function toWorkflowStepAttempt(
  dto: StepAttemptDto,
  jobId: string,
  jobExecutionId: string,
): WorkflowStepAttempt {
  return {
    id: dto.id,
    stepId: dto.step_id,
    jobId,
    jobExecutionId,
    attempt: dto.attempt,
    executionOrder: dto.execution_order,
    status: dto.status,
    exitCode: dto.exit_code ?? null,
    output: dto.output ?? null,
    error: dto.error ?? null,
    gateResult: dto.gate_result ?? null,
    restartReason: dto.restart_reason ?? null,
    restartResult: dto.restart_result ?? null,
    startedAt: dto.started_at,
    finishedAt: dto.finished_at ?? null,
  };
}

export function toWorkflowRunAttempt(dto: WorkflowRunAttemptDto): WorkflowRunAttempt {
  return {
    id: dto.id,
    workflowRunId: dto.workflow_run_id,
    attempt: dto.attempt,
    status: dto.status,
    createdAt: dto.created_at,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
    rerunMode: dto.rerun_mode,
  };
}

function toWorkflowSourceSnapshot(dto: NonNullable<WorkflowRunResponseDto['source_snapshot']>) {
  return {
    content: dto.content,
    format: dto.format,
  };
}

function toWorkflowStepSourceLocation(dto: StepSourceLocationDto): WorkflowStepSourceLocation {
  return {
    startLine: dto.start_line,
    endLine: dto.end_line,
  };
}

function toWorkflowStepError(
  dto: NonNullable<WorkflowRunStepDetailDto['error']>,
): WorkflowStepError {
  return {
    message: dto.message,
    exitCode: dto.exit_code ?? null,
    signal: dto.signal,
    reason: dto.reason,
    agentConfigIssue: dto.agent_config_issue,
    category: dto.category,
  };
}

function toWorkflowAgentStepConfig(dto: WorkflowRunStepDetailDto): WorkflowAgentStepConfig | null {
  if (dto.type !== 'agent') return null;

  return {
    provider: stringConfigValue(dto.config.provider),
    model: stringConfigValue(dto.config.model),
    thinking: stringConfigValue(dto.config.thinking),
  };
}

function stringConfigValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
}
