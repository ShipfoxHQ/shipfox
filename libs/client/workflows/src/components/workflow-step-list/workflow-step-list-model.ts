import {
  type RunJobDetailDto,
  type RunStepDetailDto,
  runStatusSchema,
} from '@shipfox/api-workflows-dto';
import {
  getWorkflowStatusVisual,
  type WorkflowStatus,
  type WorkflowStatusVisual,
} from '#components/workflow-status/status-visuals.js';

export interface WorkflowStepStatusVisual extends Omit<WorkflowStatusVisual, 'kind'> {
  kind: string;
  ripple: boolean;
}

export interface WorkflowStepAttemptModel {
  id: string;
  attempt: number;
  executionOrder: number;
  status: WorkflowStepStatusVisual;
  exitCode: number | undefined;
  restartReason: string | undefined;
  startedAt: string;
}

export interface WorkflowStepModel {
  id: string;
  index: number;
  label: string;
  status: WorkflowStepStatusVisual;
  type: string;
  currentAttempt: number;
  attemptCount: number;
  latestAttempt: WorkflowStepAttemptModel | undefined;
  attempts: WorkflowStepAttemptModel[];
  error:
    | {
        message: string;
        category: 'setup' | 'user' | undefined;
        reason: string | undefined;
      }
    | undefined;
}

export interface WorkflowStepListEntryModel {
  id: string;
  stepId: string;
  index: number;
  label: string;
  status: WorkflowStepStatusVisual;
  attempt: WorkflowStepAttemptModel;
  attemptCount: number;
  error: WorkflowStepModel['error'];
}

export interface WorkflowStepListModel {
  jobId: string;
  jobName: string;
  stepCount: number;
  activeEntryId: string | undefined;
  entries: WorkflowStepListEntryModel[];
}

export function buildWorkflowStepListModel({job}: {job: RunJobDetailDto}): WorkflowStepListModel {
  const steps = [...job.steps].sort(compareSteps).map(toStepModel);
  const entries = steps.flatMap(toStepEntries).sort(compareEntries);

  return {
    jobId: job.id,
    jobName: job.name,
    stepCount: steps.length,
    activeEntryId: latestRunningEntryId(entries),
    entries,
  };
}

export function getStepStatusVisual(status: string): WorkflowStepStatusVisual {
  const normalized = normalizeStatus(status);

  if (isWorkflowStatus(normalized)) {
    const visual = getWorkflowStatusVisual(normalized);
    return {...visual, ripple: normalized === 'running'};
  }

  return {
    kind: status,
    label: humanizeStatus(status),
    dot: 'neutral',
    badge: 'neutral',
    ripple: false,
  };
}

export function humanizeStatus(status: string): string {
  const words = status.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  if (!words) return 'Unknown';
  const firstLetter = words.at(0);
  return firstLetter === undefined ? 'Unknown' : firstLetter.toUpperCase() + words.slice(1);
}

function toStepModel(step: RunStepDetailDto, index: number): WorkflowStepModel {
  const attempts = [...step.attempts].sort(compareAttempts).map((attempt) => ({
    id: attempt.id,
    attempt: attempt.attempt,
    executionOrder: attempt.execution_order,
    status: getStepStatusVisual(attempt.status),
    exitCode: attempt.exit_code ?? undefined,
    restartReason: attempt.restart_reason ?? undefined,
    startedAt: attempt.started_at,
  }));
  const latestAttempt = attempts.at(-1);

  return {
    id: step.id,
    index: index + 1,
    label: stepLabel(step, index),
    status: getStepStatusVisual(step.status),
    type: step.type,
    currentAttempt: step.current_attempt,
    attemptCount: attempts.length,
    latestAttempt,
    attempts,
    error: step.error
      ? {
          message: step.error.message,
          category: step.error.category,
          reason: step.error.reason,
        }
      : undefined,
  };
}

function stepLabel(step: RunStepDetailDto, index: number): string {
  const displayName = step.display_name.trim();
  if (displayName) return displayName;

  const name = step.name?.trim();
  if (name) return name;

  return `Step ${index + 1}`;
}

function toStepEntries(step: WorkflowStepModel): WorkflowStepListEntryModel[] {
  return step.attempts.map((attempt) => ({
    id: attempt.id,
    stepId: step.id,
    index: step.index,
    label: step.label,
    status: attempt.status,
    attempt,
    attemptCount: step.attemptCount,
    error: step.error,
  }));
}

function compareSteps(left: RunStepDetailDto, right: RunStepDetailDto): number {
  return (
    left.position - right.position ||
    (left.name ?? '').localeCompare(right.name ?? '') ||
    left.id.localeCompare(right.id)
  );
}

function compareAttempts(
  left: RunStepDetailDto['attempts'][number],
  right: RunStepDetailDto['attempts'][number],
) {
  return left.attempt - right.attempt || left.id.localeCompare(right.id);
}

function compareEntries(
  left: WorkflowStepListEntryModel,
  right: WorkflowStepListEntryModel,
): number {
  return (
    left.attempt.executionOrder - right.attempt.executionOrder ||
    left.index - right.index ||
    left.attempt.attempt - right.attempt.attempt ||
    left.id.localeCompare(right.id)
  );
}

function latestRunningEntryId(entries: readonly WorkflowStepListEntryModel[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.status.kind === 'running') return entry.id;
  }
  return undefined;
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/-/g, '_');
}

function isWorkflowStatus(status: string): status is WorkflowStatus {
  return (runStatusSchema.options as readonly string[]).includes(status);
}
