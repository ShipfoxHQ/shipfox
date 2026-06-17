import {
  type StepAttemptDto,
  type StepDto,
  type StepErrorCategory,
  stepAttemptDtoSchema,
  stepDtoSchema,
} from '@shipfox/api-workflows-dto';
import {z} from 'zod';

export const workflowStepOverviewStepSchema = stepDtoSchema.extend({
  attempts: z.array(
    stepAttemptDtoSchema.extend({
      restart_result: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  ),
});

type WorkflowStepOverviewAttempt = Omit<StepAttemptDto, 'restart_result'> & {
  restart_result?: Record<string, unknown> | null | undefined;
};

export type WorkflowStepOverviewStep = StepDto & {attempts: WorkflowStepOverviewAttempt[]};

export interface WorkflowStepSelection {
  readonly jobName: string;
  readonly step: WorkflowStepOverviewStep;
}

export interface WorkflowStepOverviewModel {
  readonly jobName: string;
  readonly stepName: string;
  readonly stepType: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly statusVariant: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  readonly command: string | null;
  readonly currentAttempt: WorkflowStepAttemptModel | null;
  readonly attempts: WorkflowStepAttemptModel[];
  readonly summary: WorkflowStepSummaryModel | null;
  readonly outputEntries: WorkflowStepOutputEntryModel[];
  readonly positionLabel: string;
}

export interface WorkflowStepAttemptModel {
  readonly id: string;
  readonly attempt: number;
  readonly status: string;
  readonly statusLabel: string;
  readonly statusVariant: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  readonly isCurrent: boolean;
  readonly exitCodeLabel: string;
  readonly startedAtLabel: string;
  readonly finishedAtLabel: string;
  readonly restartReason: string | null;
  readonly gateResultEntries: WorkflowStepOutputEntryModel[];
  readonly restartResultEntries: WorkflowStepOutputEntryModel[];
}

export interface WorkflowStepSummaryModel {
  readonly tone: 'info' | 'error';
  readonly title: string;
  readonly body: string;
  readonly details: string | null;
  readonly category: StepErrorCategory | null;
}

export interface WorkflowStepOutputEntryModel {
  readonly key: string;
  readonly value: string;
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const statusVariants: Record<string, WorkflowStepOverviewModel['statusVariant']> = {
  pending: 'neutral',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

export function toWorkflowStepOverviewModel(
  selection: WorkflowStepSelection | null,
): WorkflowStepOverviewModel | null {
  if (selection === null) return null;

  const attempts = [...selection.step.attempts].sort((left, right) => left.attempt - right.attempt);
  const currentAttempt =
    attempts.find((attempt) => attempt.attempt === selection.step.current_attempt) ?? null;

  return {
    jobName: selection.jobName,
    stepName: selection.step.name ?? fallbackStepName(selection.step),
    stepType: selection.step.type,
    status: selection.step.status,
    statusLabel: statusLabel(selection.step.status),
    statusVariant: statusVariant(selection.step.status),
    command: readCommand(selection.step.config),
    currentAttempt: currentAttempt
      ? {
          id: currentAttempt.id,
          attempt: currentAttempt.attempt,
          status: currentAttempt.status,
          statusLabel: statusLabel(currentAttempt.status),
          statusVariant: statusVariant(currentAttempt.status),
          isCurrent: true,
          exitCodeLabel:
            currentAttempt.exit_code === null
              ? 'No exit code yet'
              : `Exit ${currentAttempt.exit_code}`,
          startedAtLabel: formatTimestamp(currentAttempt.started_at),
          finishedAtLabel: currentAttempt.finished_at
            ? formatTimestamp(currentAttempt.finished_at)
            : 'Still running',
          restartReason: currentAttempt.restart_reason,
          gateResultEntries: toOutputEntries(currentAttempt.gate_result),
          restartResultEntries: toOutputEntries(currentAttempt.restart_result ?? null),
        }
      : null,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      attempt: attempt.attempt,
      status: attempt.status,
      statusLabel: statusLabel(attempt.status),
      statusVariant: statusVariant(attempt.status),
      isCurrent: currentAttempt?.id === attempt.id,
      exitCodeLabel: attempt.exit_code === null ? 'No exit code yet' : `Exit ${attempt.exit_code}`,
      startedAtLabel: formatTimestamp(attempt.started_at),
      finishedAtLabel: attempt.finished_at ? formatTimestamp(attempt.finished_at) : 'Still running',
      restartReason: attempt.restart_reason,
      gateResultEntries: toOutputEntries(attempt.gate_result),
      restartResultEntries: toOutputEntries(attempt.restart_result ?? null),
    })),
    summary: buildSummary(selection.step, currentAttempt, attempts),
    outputEntries: toOutputEntries(currentAttempt?.output ?? null),
    positionLabel: `Step ${selection.step.position + 1}`,
  };
}

function fallbackStepName(step: WorkflowStepOverviewStep): string {
  if (step.type === 'setup') return 'Set up job';
  return `Unnamed step ${step.position + 1}`;
}

function statusLabel(status: string): string {
  return statusLabels[status] ?? status;
}

function statusVariant(status: string): WorkflowStepOverviewModel['statusVariant'] {
  return statusVariants[status] ?? 'neutral';
}

function readCommand(config: Record<string, unknown>): string | null {
  return typeof config.run === 'string' && config.run.length > 0 ? config.run : null;
}

function buildSummary(
  step: WorkflowStepOverviewStep,
  currentAttempt: WorkflowStepOverviewStep['attempts'][number] | null,
  attempts: WorkflowStepOverviewStep['attempts'],
): WorkflowStepSummaryModel | null {
  if (step.status === 'running' || currentAttempt?.status === 'running') {
    return {
      tone: 'info',
      title: 'Active step',
      body: 'Currently running. No result is available yet.',
      details: readErrorDetails(currentAttempt?.error ?? null),
      category: null,
    };
  }

  if (step.status !== 'failed' && currentAttempt?.status !== 'failed') return null;

  const failedAttempts = attempts.filter((attempt) => attempt.status === 'failed').length;
  const body = buildFailureBody(step, currentAttempt, failedAttempts);

  return {
    tone: 'error',
    title: 'Root cause',
    body,
    details: step.error?.message ?? readErrorDetails(currentAttempt?.error ?? null),
    category: step.error?.category ?? null,
  };
}

function buildFailureBody(
  step: WorkflowStepOverviewStep,
  currentAttempt: WorkflowStepOverviewStep['attempts'][number] | null,
  failedAttempts: number,
): string {
  if (step.error?.category === 'setup') {
    return step.error.reason
      ? `Setup failed (${step.error.reason.replaceAll('_', ' ')}).`
      : 'Setup failed before the step command could run.';
  }

  const exitCode = currentAttempt?.exit_code ?? step.error?.exit_code ?? null;
  const parts = [exitCode === null ? 'Step failed.' : `Failed with exit code ${exitCode}.`];
  if (failedAttempts > 1) parts.push(`${failedAttempts} attempts failed.`);
  return parts.join(' ');
}

function readErrorDetails(error: Record<string, unknown> | null): string | null {
  if (error === null) return null;
  return typeof error.message === 'string' && error.message.length > 0 ? error.message : null;
}

function toOutputEntries(output: Record<string, unknown> | null): WorkflowStepOutputEntryModel[] {
  if (output === null) return [];
  return Object.entries(output).map(([key, value]) => ({
    key,
    value: formatOutputValue(value),
  }));
}

function formatOutputValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return JSON.stringify(value, null, 2);
}

function formatTimestamp(value: string): string {
  return value.replace('T', ' ').replace('.000Z', 'Z');
}
