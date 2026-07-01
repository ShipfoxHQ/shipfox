import type {
  AgentConfigIssueDto,
  StepErrorCategoryDto,
  StepErrorReasonDto,
  StepSourceLocationDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {type StepAttempt, toStepAttempt} from './step-attempt.js';

export type StepErrorReason = StepErrorReasonDto;
export type AgentConfigIssue = AgentConfigIssueDto;
export type StepErrorCategory = StepErrorCategoryDto;

export interface StepSourceLocation {
  startLine: number;
  endLine: number;
}

export interface StepError {
  message: string;
  exitCode: number | null;
  signal: string | undefined;
  reason: StepErrorReason | undefined;
  agentConfigIssue: AgentConfigIssue | undefined;
  category: StepErrorCategory | undefined;
}

export interface AgentStepConfig {
  provider: string | null;
  model: string | null;
  thinking: string | null;
}

export interface Step {
  id: string;
  jobExecutionId: string;
  key: string | null;
  name: string;
  sourceLocation: StepSourceLocation | null;
  status: string;
  type: string;
  config: Record<string, unknown>;
  agentConfig: AgentStepConfig | null;
  error: StepError | null;
  position: number;
  currentAttempt: number;
  createdAt: string;
  updatedAt: string;
  attempts: StepAttempt[];
}

export function toStep(dto: WorkflowRunStepDetailDto): Step {
  return {
    id: dto.id,
    jobExecutionId: dto.job_execution_id,
    key: dto.key,
    name: dto.name,
    sourceLocation: dto.source_location ? toStepSourceLocation(dto.source_location) : null,
    status: dto.status,
    type: dto.type,
    config: dto.config,
    agentConfig: toAgentStepConfig(dto),
    error: dto.error ? toStepError(dto.error) : null,
    position: dto.position,
    currentAttempt: dto.current_attempt,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    attempts: dto.attempts.map((attempt) => toStepAttempt(attempt, dto.job_execution_id)),
  };
}

function toStepSourceLocation(dto: StepSourceLocationDto): StepSourceLocation {
  return {
    startLine: dto.start_line,
    endLine: dto.end_line,
  };
}

function toStepError(dto: NonNullable<WorkflowRunStepDetailDto['error']>): StepError {
  return {
    message: dto.message,
    exitCode: dto.exit_code ?? null,
    signal: dto.signal,
    reason: dto.reason,
    agentConfigIssue: dto.agent_config_issue,
    category: dto.category,
  };
}

function toAgentStepConfig(dto: WorkflowRunStepDetailDto): AgentStepConfig | null {
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
