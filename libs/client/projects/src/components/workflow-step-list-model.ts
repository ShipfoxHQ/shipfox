import type {JobDto, StepAttemptDto, StepDto} from '@shipfox/api-workflows-dto';
import type {IconName} from '@shipfox/react-ui';
import type {StatusDotVariant} from './status-dot.js';

export type WorkflowStepListStep = StepDto & {attempts: StepAttemptDto[]};
export type WorkflowStepListJob = JobDto & {steps: WorkflowStepListStep[]};

export type WorkflowStepListTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

export interface WorkflowStepListModel {
  id: string;
  name: string;
  statusLabel: string;
  statusTone: WorkflowStepListTone;
  stepCount: number;
  steps: WorkflowStepListStepModel[];
}

export interface WorkflowStepListStepModel {
  id: string;
  label: string;
  positionLabel: string;
  status: string;
  statusTone: WorkflowStepListTone;
  dotVariant: StatusDotVariant;
  isRunning: boolean;
  isSetup: boolean;
  hasRestart: boolean;
  noAttemptsLabel: string;
  command: string | null;
  errorMessage: string | null;
  attempts: WorkflowStepListAttemptModel[];
}

export interface WorkflowStepListAttemptModel {
  id: string;
  attempt: number;
  attemptLabel: string;
  status: string;
  statusLabel: string;
  statusTone: WorkflowStepListTone;
  statusIcon: IconName;
  isRunning: boolean;
  title: string;
  exitCodeLabel: string | null;
  restartBadgeLabel: string | null;
  errorMessage: string | null;
}

const statusToneByStatus: Record<string, WorkflowStepListTone> = {
  pending: 'neutral',
  queued: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
  'runner-disappeared': 'error',
  'timed-out': 'error',
  'awaiting-runner': 'warning',
  'awaiting-manual': 'warning',
  delayed: 'neutral',
};

const statusLabelByStatus: Record<string, string> = {
  pending: 'Pending',
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  'runner-disappeared': 'Runner lost',
  'timed-out': 'Timed out',
  'awaiting-runner': 'Awaiting runner',
  'awaiting-manual': 'Manual',
  delayed: 'Delayed',
};

const dotVariantByTone: Record<WorkflowStepListTone, StatusDotVariant> = {
  neutral: 'neutral',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

export function toWorkflowStepListModel(job: WorkflowStepListJob): WorkflowStepListModel {
  const steps = [...job.steps].sort((a, b) => a.position - b.position);
  return {
    id: job.id,
    name: job.name,
    statusLabel: formatStatusLabel(job.status),
    statusTone: statusTone(job.status),
    stepCount: steps.length,
    steps: steps.map((step, index) => toStepModel(step, index)),
  };
}

function toStepModel(step: WorkflowStepListStep, index: number): WorkflowStepListStepModel {
  const attempts = [...step.attempts].sort((a, b) => a.attempt - b.attempt).map(toAttemptModel);
  const tone = statusTone(step.status);

  return {
    id: step.id,
    label: step.name ?? `Step ${index + 1}`,
    positionLabel: String(index + 1).padStart(2, '0'),
    status: step.status,
    statusTone: tone,
    dotVariant: dotVariantByTone[tone],
    isRunning: step.status === 'running',
    isSetup: step.type === 'setup',
    hasRestart: attempts.some((attempt) => attempt.restartBadgeLabel !== null),
    noAttemptsLabel: step.status === 'pending' ? 'not started' : 'not run',
    command: commandSummary(step),
    errorMessage: step.error?.message ?? null,
    attempts,
  };
}

function toAttemptModel(attempt: StepAttemptDto): WorkflowStepListAttemptModel {
  const label = formatStatusLabel(attempt.status);
  const exitCodeLabel = attempt.exit_code === null ? null : `exit ${attempt.exit_code}`;
  return {
    id: attempt.id,
    attempt: attempt.attempt,
    attemptLabel: `#${attempt.attempt}`,
    status: attempt.status,
    statusLabel: label,
    statusTone: statusTone(attempt.status),
    statusIcon: statusIcon(attempt.status),
    isRunning: attempt.status === 'running',
    title: `Attempt ${attempt.attempt}, ${label}${exitCodeLabel ? `, ${exitCodeLabel}` : ''}`,
    exitCodeLabel,
    restartBadgeLabel: attempt.restart_reason ? 'restart queued' : null,
    errorMessage: attemptErrorMessage(attempt),
  };
}

function statusTone(status: string): WorkflowStepListTone {
  return statusToneByStatus[status] ?? 'neutral';
}

function formatStatusLabel(status: string): string {
  return statusLabelByStatus[status] ?? titleCaseStatus(status);
}

function titleCaseStatus(status: string) {
  return status
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusIcon(status: string): IconName {
  if (status === 'succeeded') return 'checkLine';
  if (
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timed-out' ||
    status === 'runner-disappeared'
  ) {
    return 'close';
  }
  return 'ellipseMiniSolid';
}

function commandSummary(step: WorkflowStepListStep): string | null {
  if (typeof step.config.run === 'string') return step.config.run;
  if (step.type === 'setup') return 'Prepare job workspace';
  return null;
}

function attemptErrorMessage(attempt: StepAttemptDto): string | null {
  const error = attempt.error;
  if (!error) return null;
  const message = error.message;
  return typeof message === 'string' ? message : null;
}
