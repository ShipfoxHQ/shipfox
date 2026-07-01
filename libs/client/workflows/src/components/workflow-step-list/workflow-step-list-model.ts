import {
  getWorkflowStatusVisual,
  type WorkflowStatusVisual,
} from '#components/workflow-status/status-visuals.js';
import {
  isWorkflowStatus as isKnownWorkflowStatus,
  type WorkflowJob,
  type WorkflowJobExecution,
  type WorkflowStep,
  type WorkflowStepAttempt,
} from '#core/workflow-run.js';

export interface WorkflowStepStatusVisual extends Omit<WorkflowStatusVisual, 'kind'> {
  kind: string;
  ripple: boolean;
}

export interface WorkflowStepAttemptModel extends WorkflowStepAttempt {
  statusVisual: WorkflowStepStatusVisual;
  carriedOver: boolean;
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
  jobId: string;
  jobName: string;
  jobExecutionId: string;
  stepCount: number;
  activeEntryId: string | undefined;
  entries: WorkflowStepListEntryModel[];
}

export function buildWorkflowStepListModel({
  job,
  jobExecution,
}: {
  job: WorkflowJob;
  jobExecution?: WorkflowJobExecution | undefined;
}): WorkflowStepListModel {
  const selectedJobExecution = jobExecution ?? job.jobExecutions[0] ?? emptyJobExecutionForJob(job);
  const steps = [...selectedJobExecution.steps].sort(compareSteps).map(toStepModel);
  const entries = steps
    .flatMap((step) => toStepEntries(step, job.carriedOver))
    .sort(compareEntries);

  return {
    jobId: job.id,
    jobName: job.name ?? job.key,
    jobExecutionId: selectedJobExecution.id,
    stepCount: steps.length,
    activeEntryId: latestRunningEntryId(entries),
    entries,
  };
}

function emptyJobExecutionForJob(job: WorkflowJob): WorkflowJobExecution {
  return {
    id: `missing:${job.id}`,
    jobId: job.id,
    sequence: 1,
    name: job.name ?? job.key,
    status: job.status === 'skipped' ? 'cancelled' : job.status,
    statusReason: job.statusReason,
    queuedAt: job.queuedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    timedOutAt: null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    steps: [],
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
    carriedOver: false,
  }));

  return {
    ...step,
    index: index + 1,
    label: stepLabel(step, index),
    attempts,
  };
}

function stepLabel(step: WorkflowStep, index: number): string {
  const name = step.name.trim();
  if (name) return name;

  const key = step.key?.trim();
  if (key) return key;

  return `Step ${index + 1}`;
}

function toStepEntries(
  step: WorkflowStepModel,
  carriedOverJob: boolean,
): WorkflowStepListEntryModel[] {
  if (step.attempts.length > 0) {
    return step.attempts.map((attempt) => ({
      ...attempt,
      step,
    }));
  }

  if (!carriedOverJob) return [];

  return [
    {
      id: `carried-over:${step.id}`,
      stepId: step.id,
      jobId: step.jobId,
      jobExecutionId: step.jobExecutionId,
      attempt: step.currentAttempt,
      executionOrder: step.position,
      status: step.status,
      exitCode: null,
      output: null,
      error: null,
      gateResult: null,
      restartReason: null,
      restartResult: null,
      startedAt: step.createdAt,
      finishedAt: null,
      statusVisual: getStepStatusVisual(step.status),
      carriedOver: true,
      step,
    },
  ];
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

function latestRunningEntryId(entries: readonly WorkflowStepListEntryModel[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.statusVisual.kind === 'running') return entry.id;
  }
  return undefined;
}

function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/-/g, '_');
}
