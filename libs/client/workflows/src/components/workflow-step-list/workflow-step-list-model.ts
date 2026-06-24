import {
  getWorkflowStatusVisual,
  type WorkflowStatusVisual,
} from '#components/workflow-status/status-visuals.js';
import {
  isWorkflowStatus as isKnownWorkflowStatus,
  type WorkflowJob,
  type WorkflowStep,
  type WorkflowStepAttempt,
} from '#core/workflow-run.js';

export interface WorkflowStepStatusVisual extends Omit<WorkflowStatusVisual, 'kind'> {
  kind: string;
  ripple: boolean;
}

export interface WorkflowStepAttemptModel extends WorkflowStepAttempt {
  statusVisual: WorkflowStepStatusVisual;
}

export interface WorkflowStepModel extends Omit<WorkflowStep, 'attempts'> {
  index: number;
  label: string;
  attempts: WorkflowStepAttemptModel[];
}

export interface WorkflowStepListEntryModel extends WorkflowStepAttemptModel {
  step: WorkflowStepModel;
}

export interface WorkflowStepListModel {
  entries: WorkflowStepListEntryModel[];
}

export function buildWorkflowStepListModel({job}: {job: WorkflowJob}): WorkflowStepListModel {
  const steps = [...job.steps].sort(compareSteps).map(toStepModel);
  const entries = steps.flatMap(toStepEntries).sort(compareEntries);

  return {
    entries,
  };
}

export function getStepStatusVisual(status: string): WorkflowStepStatusVisual {
  const normalized = normalizeStatus(status);

  if (isKnownWorkflowStatus(normalized)) {
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

function toStepModel(step: WorkflowStep, index: number): WorkflowStepModel {
  const attempts = [...step.attempts].sort(compareAttempts).map((attempt) => ({
    ...attempt,
    statusVisual: getStepStatusVisual(attempt.status),
  }));

  return {
    ...step,
    index: index + 1,
    label: stepLabel(step, index),
    attempts,
  };
}

function stepLabel(step: WorkflowStep, index: number): string {
  const displayName = step.displayName.trim();
  if (displayName) return displayName;

  const name = step.name?.trim();
  if (name) return name;

  return `Step ${index + 1}`;
}

function toStepEntries(step: WorkflowStepModel): WorkflowStepListEntryModel[] {
  return step.attempts.map((attempt) => ({
    ...attempt,
    step,
  }));
}

function compareSteps(left: WorkflowStep, right: WorkflowStep): number {
  return (
    left.position - right.position ||
    (left.name ?? '').localeCompare(right.name ?? '') ||
    left.id.localeCompare(right.id)
  );
}

function compareAttempts(
  left: WorkflowStep['attempts'][number],
  right: WorkflowStep['attempts'][number],
) {
  return left.attempt - right.attempt || left.id.localeCompare(right.id);
}

function compareEntries(
  left: WorkflowStepListEntryModel,
  right: WorkflowStepListEntryModel,
): number {
  return (
    left.executionOrder - right.executionOrder ||
    left.step.index - right.step.index ||
    left.attempt - right.attempt ||
    left.id.localeCompare(right.id)
  );
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/-/g, '_');
}
