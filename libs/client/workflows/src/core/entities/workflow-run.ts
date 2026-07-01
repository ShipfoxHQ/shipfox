import type {
  WorkflowRunDetailResponseDto,
  WorkflowRunListResponseDto,
  WorkflowRunResponseDto,
  WorkflowRunStatusDto,
} from '@shipfox/api-workflows-dto';
import {type Job, toJob, WORKFLOW_JOB_STATUSES} from './job.js';
import {toWorkflowRunAttempt, type WorkflowRunAttempt} from './workflow-run-attempt.js';

export type WorkflowRunStatus = WorkflowRunStatusDto;
export type WorkflowStatus = WorkflowRunStatus | (typeof WORKFLOW_JOB_STATUSES)[number];

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

const WORKFLOW_STATUSES = new Set<WorkflowStatus>([
  ...WORKFLOW_RUN_STATUSES,
  ...WORKFLOW_JOB_STATUSES,
]);
const TERMINAL_WORKFLOW_RUN_STATUS_SET = new Set<WorkflowRunStatus>(TERMINAL_WORKFLOW_RUN_STATUSES);

export interface WorkflowSourceSnapshot {
  content: string;
  format: 'yaml';
}

export interface WorkflowRun {
  id: string;
  projectId: string;
  definitionId: string;
  name: string;
  currentAttempt: number;
  triggerProvider: string | null;
  triggerSource: string;
  triggerEvent: string;
  triggerDisplayLabel: string;
  triggerLabel: string;
  triggerPayload: Record<string, unknown>;
  inputs: Record<string, unknown> | null;
  sourceSnapshot: WorkflowSourceSnapshot | null;
  createdAt: string;
  updatedAt: string;
  shortId: string;
  isTemporary: boolean;
}

export interface WorkflowRunListItem extends WorkflowRun {
  status: WorkflowRunStatus;
  latestAttempt: number;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface WorkflowRunDetail extends WorkflowRun {
  latestAttempt: number;
  runAttempt: WorkflowRunAttempt;
  jobs: Job[];
}

export interface WorkflowRunListPage {
  runs: WorkflowRunListItem[];
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
    currentAttempt: dto.current_attempt,
    triggerProvider: dto.trigger_provider,
    triggerSource: dto.trigger_source,
    triggerEvent: dto.trigger_event,
    triggerDisplayLabel,
    triggerLabel,
    triggerPayload: dto.trigger_payload,
    inputs: dto.inputs ?? null,
    sourceSnapshot: dto.source_snapshot ? toWorkflowSourceSnapshot(dto.source_snapshot) : null,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    shortId: workflowRunShortId(dto.id),
    isTemporary: dto.id.startsWith('temp-'),
  };
}

export function toWorkflowRunListItem(dto: WorkflowRunResponseDto): WorkflowRunListItem {
  return {
    ...toWorkflowRun(dto),
    status: dto.status,
    latestAttempt: dto.latest_attempt,
    startedAt: dto.started_at ?? null,
    finishedAt: dto.finished_at ?? null,
  };
}

export function toWorkflowRunDetail(dto: WorkflowRunDetailResponseDto): WorkflowRunDetail {
  return {
    ...toWorkflowRun(dto),
    latestAttempt: dto.latest_attempt,
    runAttempt: toWorkflowRunAttempt(dto.run_attempt),
    jobs: dto.jobs.map(toJob),
  };
}

export function toWorkflowRunListPage(dto: WorkflowRunListResponseDto): WorkflowRunListPage {
  return {
    runs: dto.runs.map(toWorkflowRunListItem),
    nextCursor: dto.next_cursor,
    filteredTotalCount: dto.filtered_total_count,
  };
}

function toWorkflowSourceSnapshot(
  dto: NonNullable<WorkflowRunResponseDto['source_snapshot']>,
): WorkflowSourceSnapshot {
  return {
    content: dto.content,
    format: dto.format,
  };
}
